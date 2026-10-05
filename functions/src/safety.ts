/**
 * Player safety tools for App Store guideline 1.2: reporting, blocking, admin removal and
 * an offensive-name screen. Pure rules (name filter, reasons, block lists) live in
 * models/safety.ts so the app applies the same checks before saving.
 *
 * Reports land in `reports/{id}` (admin-readable, function-written) and push every admin.
 * Blocks live in `userBlocks/{uid}` (owner-readable, function-written) so a block always
 * files a report too — Apple expects blocking to notify the developer.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { loggedOnCall } from "./logging";
import { instrumentBackground } from "./sentry";
import { requireAuth, assertAdmin, assertMember } from "./auth";
import { LEAGUE_ID } from "./config";
import { isActiveMember, memberRef, userBlocksRef } from "./members";
import { sendPush } from "./notify";
import {
  REPORT_DETAILS_MAX,
  REPORT_REASON_LABELS,
  isOffensiveName,
  isReportReason,
  neutralProfileName,
  nextBlockList,
  type ReportReason,
} from "./models/safety";

const db = getFirestore();
const REPORTS_PER_DAY = 10;

interface ReportInput {
  reporterId: string;
  targetId: string;
  reason: ReportReason;
  details: string;
  matchId: string | null;
  source: "user" | "block" | "auto";
}

async function displayNameOf(uid: string): Promise<string> {
  const name = (await db.doc(`profiles/${uid}`).get()).get("displayName");
  return typeof name === "string" && name ? name : "A player";
}

/** Push every active admin; the report itself is the record, so delivery is best-effort. */
async function notifyAdmins(title: string, body: string, data: Record<string, string>) {
  const admins = await db
    .collection(`leagues/${LEAGUE_ID}/members`)
    .where("role", "==", "admin")
    .get();
  await Promise.all(
    admins.docs.filter(isActiveMember).map((admin) => sendPush(admin.id, title, body, data)),
  );
}

async function fileReport(input: ReportInput): Promise<string> {
  const ref = db.collection("reports").doc();
  await ref.set({ ...input, status: "open", createdAt: FieldValue.serverTimestamp() });
  const name = await displayNameOf(input.targetId);
  await notifyAdmins(
    input.source === "auto" ? "Name taken down" : "New player report",
    `${name}: ${REPORT_REASON_LABELS[input.reason]}. Review it in the admin dashboard.`,
    { type: "report", reportId: ref.id },
  );
  return ref.id;
}

/** True when `reporterId` already filed a report like this one about `targetId`. */
async function hasReport(filter: {
  reporterId?: string;
  targetId: string;
  source: ReportInput["source"];
  openOnly?: boolean;
}): Promise<boolean> {
  const snap = await db.collection("reports").where("targetId", "==", filter.targetId).get();
  return snap.docs.some(
    (doc) =>
      doc.get("source") === filter.source &&
      (filter.reporterId === undefined || doc.get("reporterId") === filter.reporterId) &&
      (!filter.openOnly || doc.get("status") === "open"),
  );
}

function targetOf(data: unknown, uid: string): string {
  const targetUid = String((data as { targetUid?: unknown })?.targetUid ?? "").trim();
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid is required.");
  if (targetUid === uid) throw new HttpsError("invalid-argument", "You can't do that to yourself.");
  return targetUid;
}

/** Any member can report another member; admins are pushed and review it within 24 hours. */
export const reportPlayer = loggedOnCall("reportPlayer", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertMember(uid);
  const targetId = targetOf(req.data, uid);
  const reason = req.data?.reason;
  if (!isReportReason(reason)) throw new HttpsError("invalid-argument", "Pick a reason.");
  const details = String(req.data?.details ?? "")
    .trim()
    .slice(0, REPORT_DETAILS_MAX);
  const matchId = typeof req.data?.matchId === "string" ? req.data.matchId.slice(0, 128) : null;

  if (!(await memberRef(targetId).get()).exists)
    throw new HttpsError("not-found", "Player not found.");
  const since = Date.now() - 86400000;
  const recent = (await db.collection("reports").where("reporterId", "==", uid).get()).docs.filter(
    (doc) => (doc.get("createdAt")?.toMillis?.() ?? Date.now()) > since,
  );
  if (recent.length >= REPORTS_PER_DAY)
    throw new HttpsError(
      "resource-exhausted",
      "You've sent a lot of reports today. Email support if something urgent is going on.",
    );

  const reportId = await fileReport({
    reporterId: uid,
    targetId,
    reason,
    details,
    matchId,
    source: "user",
  });
  return { ok: true, reportId };
});

/**
 * Block or unblock a player. Blocking hides their name, photos and feed activity from you,
 * stops either of you recording matches against the other, and files a report.
 */
export const setPlayerBlocked = loggedOnCall("setPlayerBlocked", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertMember(uid);
  const targetId = targetOf(req.data, uid);
  const blocked = req.data?.blocked === true;
  if (!(await memberRef(targetId).get()).exists)
    throw new HttpsError("not-found", "Player not found.");

  const ref = userBlocksRef(uid);
  const wasBlocked = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.get("blocked");
    const before = Array.isArray(current) && current.includes(targetId);
    tx.set(ref, {
      blocked: nextBlockList(current, targetId, blocked),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return before;
  });
  // One report per pair: blocking again after an unblock doesn't page the admins again.
  if (blocked && !wasBlocked && !(await hasReport({ reporterId: uid, targetId, source: "block" })))
    await fileReport({
      reporterId: uid,
      targetId,
      reason: "harassment",
      details: "Blocked from their profile.",
      matchId: null,
      source: "block",
    });
  return { ok: true, blocked };
});

/** Admin: mark a report handled. */
export const resolveReport = loggedOnCall("resolveReport", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const reportId = String(req.data?.reportId ?? "").trim();
  const status = req.data?.status;
  if (!reportId) throw new HttpsError("invalid-argument", "reportId is required.");
  if (status !== "dismissed" && status !== "actioned")
    throw new HttpsError("invalid-argument", "status must be 'dismissed' or 'actioned'.");
  const ref = db.doc(`reports/${reportId}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Report not found.");
  await ref.update({ status, resolvedBy: uid, resolvedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

/**
 * Admin: remove a member from the league (they keep their history but lose access, and a
 * join code can't re-admit them), reinstate them, or replace an offensive name.
 */
export const moderateMember = loggedOnCall("moderateMember", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const targetId = targetOf(req.data, uid);
  const action = req.data?.action;
  const ref = memberRef(targetId);
  const member = await ref.get();
  if (!member.exists) throw new HttpsError("not-found", "Player not found.");
  if (member.get("status") === "deleted")
    throw new HttpsError("failed-precondition", "That account has been deleted.");

  if (action === "remove") {
    await ref.update({
      status: "removed",
      role: "member",
      removedAt: FieldValue.serverTimestamp(),
      removedBy: uid,
    });
  } else if (action === "reinstate") {
    await ref.update({
      status: FieldValue.delete(),
      removedAt: FieldValue.delete(),
      removedBy: FieldValue.delete(),
    });
  } else if (action === "reset_name") {
    const profile = db.doc(`profiles/${targetId}`);
    const jersey = (await profile.get()).get("jersey");
    await profile.set(
      { ...neutralProfileName(jersey), nameModeratedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } else {
    throw new HttpsError("invalid-argument", "Unknown action.");
  }
  return { ok: true, action };
});

/**
 * Profiles are written straight from the app, so this is the backstop for names that slip
 * past the in-app check (older app versions, direct writes): swap in a neutral name and
 * tell the admins.
 */
export const screenProfileName = onDocumentWritten(
  { document: "profiles/{uid}", retry: true },
  instrumentBackground("screenProfileName", async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const name = String(after.get("displayName") ?? "");
    const handle = String(after.get("handle") ?? "");
    if (!isOffensiveName(name) && !isOffensiveName(handle)) return;

    await after.ref.update({
      ...neutralProfileName(after.get("jersey")),
      nameModeratedAt: FieldValue.serverTimestamp(),
    });
    // The name is replaced either way. Admins only hear about league members, once per
    // open report, so re-saving a name in a loop can't flood them.
    if (!isActiveMember(await memberRef(event.params.uid).get())) return;
    if (await hasReport({ targetId: event.params.uid, source: "auto", openOnly: true })) return;
    await fileReport({
      reporterId: "system",
      targetId: event.params.uid,
      reason: "offensive_name",
      details: `"${name}" (@${handle}) was replaced automatically.`,
      matchId: null,
      source: "auto",
    });
  }),
);
