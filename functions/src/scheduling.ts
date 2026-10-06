import { getFirestore, FieldValue, Timestamp, FieldPath } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { matchCreatedMillis, canAutoConfirm, opponentOf } from "./matchRules";
import { readPushReach } from "./notify";
import { AUTO_CONFIRM_HOLD, autoConfirmDueMillis, reminderDueMillis } from "./models/matchPolicy";

/**
 * Stamp a pending match's reminder and auto-confirm times, once. A match only gets an
 * auto-confirm time when its opponent can be told about it right now: a web-only player has
 * no push device, and one who muted confirmations gets no push, so a result must never lock
 * in on their behalf unseen. Those wait for a manual confirmation (or an admin) instead.
 */
export async function schedulePendingMatch(
  ref: FirebaseFirestore.DocumentReference,
): Promise<void> {
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref),
      data = snap.data();
    if (!data || data.status !== "pending_confirmation" || "autoConfirmDueAt" in data) return;
    const created = matchCreatedMillis(data);
    if (created === null) return;
    const opponentId = opponentOf(data);
    // Finals never auto-confirm, so their opponent's reach doesn't matter.
    const reach =
      opponentId !== null && canAutoConfirm(data, created)
        ? await readPushReach(opponentId, "match_pending", tx)
        : null;
    const held = reach !== null && reach !== "reachable";
    if (held) logger.info("auto_confirm_held", { matchId: ref.id, reason: reach, at: "submit" });
    tx.update(ref, {
      autoConfirmDueAt:
        reach === "reachable" ? Timestamp.fromMillis(autoConfirmDueMillis(created)) : null,
      ...(held ? { autoConfirmHold: AUTO_CONFIRM_HOLD } : {}),
      reminderDueAt: Timestamp.fromMillis(reminderDueMillis(created)),
      reminderSentAt: data.reminderSentAt ?? null,
    });
  });
}
/** One bounded migration page per scheduler run; older pending results keep their original age. */
export async function migratePendingScheduling(): Promise<void> {
  const db = getFirestore(),
    ref = db.doc("systemState/performanceScheduling");
  const state = await ref.get();
  if (state.get("complete")) return;
  let query = db
    .collection("matches")
    .where("status", "==", "pending_confirmation")
    .orderBy(FieldPath.documentId())
    .limit(200);
  const cursor = state.get("cursor");
  if (typeof cursor === "string") query = query.startAfter(cursor);
  const page = await query.get();
  for (let i = 0; i < page.docs.length; i += 10)
    await Promise.all(page.docs.slice(i, i + 10).map((row) => schedulePendingMatch(row.ref)));
  await ref.set({
    cursor: page.docs.at(-1)?.id ?? cursor ?? null,
    complete: page.size < 200,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
