/**
 * Report, block and admin moderation (App Store guideline 1.2). All writes go through
 * callables: a block also files a report, and reports push the admins.
 */
import { collection, getDocs, limit, orderBy, query, where, documentId } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { mutate } from "../dataCache";
import { asNullableDate } from "./firestoreMap";
import { getBlockedIds } from "./players";
import type { ReportReason } from "../../../../functions/src/models/safety";

export {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  REPORT_DETAILS_MAX,
  type ReportReason,
} from "../../../../functions/src/models/safety";

export async function reportPlayer(input: {
  targetUid: string;
  reason: ReportReason;
  details?: string;
  matchId?: string;
}): Promise<void> {
  const callable = httpsCallable<typeof input, { ok: boolean }>(functions, "reportPlayer");
  await callable(input);
}

export async function setPlayerBlocked(targetUid: string, blocked: boolean): Promise<void> {
  const callable = httpsCallable<{ targetUid: string; blocked: boolean }, { ok: boolean }>(
    functions,
    "setPlayerBlocked",
  );
  await mutate(() => callable({ targetUid, blocked }));
}

export interface BlockedPlayer {
  id: string;
  name: string;
  handle: string;
}

/** Your block list with real names, for managing it (everywhere else they're masked). */
export async function getBlockedPlayers(): Promise<BlockedPlayer[]> {
  const ids = [...(await getBlockedIds())];
  const rows: BlockedPlayer[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(
      query(collection(db, "profiles"), where(documentId(), "in", ids.slice(i, i + 30))),
    );
    for (const row of snap.docs)
      rows.push({
        id: row.id,
        name: String(row.get("displayName") ?? "Player"),
        handle: String(row.get("handle") ?? ""),
      });
  }
  // Ids without a readable profile (e.g. since removed) can still be unblocked.
  for (const id of ids)
    if (!rows.some((row) => row.id === id)) rows.push({ id, name: "Former player", handle: "" });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface PlayerReport {
  id: string;
  reporterId: string;
  targetId: string;
  reason: ReportReason;
  details: string;
  matchId: string | null;
  source: "user" | "block" | "auto";
  status: "open" | "dismissed" | "actioned";
  createdAt: Date | null;
}

/** Admin: recent reports, newest first (single-field order, so no composite index). */
export async function getReports(max = 50): Promise<PlayerReport[]> {
  const snap = await getDocs(
    query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(max)),
  );
  return snap.docs.map((row) => {
    const data = row.data();
    return {
      id: row.id,
      reporterId: String(data.reporterId ?? ""),
      targetId: String(data.targetId ?? ""),
      reason: data.reason as ReportReason,
      details: String(data.details ?? ""),
      matchId: typeof data.matchId === "string" ? data.matchId : null,
      source: data.source ?? "user",
      status: data.status ?? "open",
      createdAt: asNullableDate(data.createdAt),
    };
  });
}

export async function resolveReport(
  reportId: string,
  status: "dismissed" | "actioned",
): Promise<void> {
  const callable = httpsCallable<{ reportId: string; status: string }, { ok: boolean }>(
    functions,
    "resolveReport",
  );
  await mutate(() => callable({ reportId, status }));
}

export type ModerationAction = "remove" | "reinstate" | "reset_name";

/** Admin: remove from / reinstate to the league, or replace an offensive name. */
export async function moderateMember(targetUid: string, action: ModerationAction): Promise<void> {
  const callable = httpsCallable<{ targetUid: string; action: ModerationAction }, { ok: boolean }>(
    functions,
    "moderateMember",
  );
  await mutate(() => callable({ targetUid, action }));
}
