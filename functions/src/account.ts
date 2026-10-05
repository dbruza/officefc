/**
 * In-app account deletion (App Store guideline 5.1.1(v)).
 *
 * Personal data goes: the login, email, profile name/handle, match photos and drafts, push
 * tokens, preferences, blocks and reports filed. League history stays, keyed by the now
 * meaningless uid, so opponents keep their results and ratings: the member and profile docs
 * become a "Deleted player" tombstone that every screen can still resolve. Open
 * (unconfirmed or disputed) matches are voided because nobody can confirm them any more.
 */
import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getAuth } from "firebase-admin/auth";
import {
  getFirestore,
  FieldValue,
  type DocumentReference,
  type QueryDocumentSnapshot,
  type UpdateData,
} from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { loggedOnCall } from "./logging";
import { requireAuth } from "./auth";
import { memberRef } from "./members";
import { DELETED_PLAYER_HANDLE, DELETED_PLAYER_NAME } from "./models/safety";

/** The client re-enters the password just before deleting; older sign-ins must do so. */
const REAUTH_WINDOW_SECONDS = 10 * 60;
const OPEN_STATUSES = new Set(["pending_confirmation", "disputed"]);
const TOMBSTONE_COLOR = "#5b6472";

type Write =
  | { kind: "delete"; ref: DocumentReference }
  | { kind: "update"; ref: DocumentReference; data: UpdateData<FirebaseFirestore.DocumentData> };

async function commitAll(writes: Write[]): Promise<void> {
  const db = getFirestore();
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + 400)) {
      if (write.kind === "delete") batch.delete(write.ref);
      else batch.update(write.ref, write.data);
    }
    await batch.commit();
  }
}

/** What has to change on one of the user's matches; null when nothing does. */
export function matchErasure(
  uid: string,
  data: FirebaseFirestore.DocumentData,
): Record<string, unknown> | null {
  const update: Record<string, unknown> = {};
  if (data.submittedBy === uid && typeof data.photoPath === "string" && data.photoPath) {
    update.photoPath = FieldValue.delete();
    update.photoDeletedAt = FieldValue.serverTimestamp();
  }
  if (data.disputedBy === uid && data.disputeReason) update.disputeReason = FieldValue.delete();
  if (OPEN_STATUSES.has(String(data.status))) {
    Object.assign(update, {
      status: "voided",
      resolution: "voided",
      resolvedBy: "system",
      resolvedAt: FieldValue.serverTimestamp(),
      resolutionReason: "A player deleted their account.",
      previousStatus: data.status,
      previousScore: { aGoals: data.aGoals, bGoals: data.bGoals },
    });
  }
  return Object.keys(update).length ? update : null;
}

/** Remove or anonymise everything stored about a user. Safe to re-run after a partial failure. */
export async function eraseUserData(uid: string): Promise<{ matchesTouched: number }> {
  const db = getFirestore();
  const member = await memberRef(uid).get();
  const [asA, asB, drafts, reports, outbox] = await Promise.all([
    db.collection("matches").where("aId", "==", uid).get(),
    db.collection("matches").where("bId", "==", uid).get(),
    db.collection("matchDrafts").where("ownerUid", "==", uid).get(),
    db.collection("reports").where("reporterId", "==", uid).get(),
    db.collection("notificationOutbox").where("uid", "==", uid).get(),
  ]);
  const matches = new Map<string, QueryDocumentSnapshot>();
  for (const doc of [...asA.docs, ...asB.docs]) matches.set(doc.id, doc);

  const writes: Write[] = [];
  for (const doc of matches.values()) {
    const update = matchErasure(uid, doc.data());
    if (update) writes.push({ kind: "update", ref: doc.ref, data: update });
    // Generated analysis prose names both players.
    writes.push({ kind: "delete", ref: db.doc(`matchAnalysis/${doc.id}`) });
  }
  for (const doc of [...drafts.docs, ...reports.docs, ...outbox.docs])
    writes.push({ kind: "delete", ref: doc.ref });
  for (const path of [
    `pushPrefs/${uid}`,
    `privacySettings/${uid}`,
    `userBlocks/${uid}`,
    `aiRateLimits/${uid}`,
    `aiRateLimits/${uid}:analysis`,
    `joinAttempts/${uid}`,
  ])
    writes.push({ kind: "delete", ref: db.doc(path) });
  await commitAll(writes);

  await db.recursiveDelete(db.doc(`deviceTokens/${uid}`));
  await getStorage()
    .bucket()
    .deleteFiles({ prefix: `match-photos/${uid}/` });

  if (member.exists) {
    // Overwrites (not merges) so nothing personal survives on either doc.
    await db.doc(`profiles/${uid}`).set({
      displayName: DELETED_PLAYER_NAME,
      handle: DELETED_PLAYER_HANDLE,
      jersey: 0,
      color: TOMBSTONE_COLOR,
      deletedAt: FieldValue.serverTimestamp(),
    });
    await memberRef(uid).set({
      role: "member",
      status: "deleted",
      joinedAt: member.get("joinedAt") ?? null,
      deletedAt: FieldValue.serverTimestamp(),
    });
  } else {
    // Never joined, so no league history refers to them.
    await db.doc(`profiles/${uid}`).delete();
  }
  return { matchesTouched: matches.size };
}

export const deleteAccount = loggedOnCall(
  "deleteAccount",
  { cors: true, timeoutSeconds: 120 },
  async (req) => {
    const { uid } = requireAuth(req);
    const authTime = Number(req.auth?.token.auth_time ?? 0);
    if (!authTime || Date.now() / 1000 - authTime > REAUTH_WINDOW_SECONDS) {
      throw new HttpsError(
        "failed-precondition",
        "For your security, enter your password again to delete your account.",
      );
    }

    const { matchesTouched } = await eraseUserData(uid);
    try {
      await getAuth().deleteUser(uid);
    } catch (error) {
      // A retry after the login was already removed still counts as done.
      if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    }
    logger.info("account_deleted", { uid, matchesTouched });
    return { ok: true };
  },
);
