import { getFirestore, FieldValue, Timestamp, FieldPath } from "firebase-admin/firestore";
import { matchCreatedMillis, canAutoConfirm } from "./matchRules";
export async function schedulePendingMatch(
  ref: FirebaseFirestore.DocumentReference,
): Promise<void> {
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref),
      data = snap.data();
    if (!data || data.status !== "pending_confirmation" || data.autoConfirmDueAt) return;
    const created = matchCreatedMillis(data);
    if (created === null) return;
    tx.update(ref, {
      autoConfirmDueAt: canAutoConfirm(data, created)
        ? Timestamp.fromMillis(created + 3600000)
        : null,
      reminderDueAt: Timestamp.fromMillis(created + 1800000),
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
