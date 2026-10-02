import { isDeepStrictEqual } from "node:util";
import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type SetOptions,
} from "firebase-admin/firestore";

export const QUEUE_PATH = "readModelQueue/office";
export interface RebuildLease {
  token: string;
}
export function changedFields(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): boolean {
  return (
    !previous ||
    Object.entries(next).some(
      ([key, value]) =>
        key !== "updatedAt" && key !== "recalculatedAt" && !isDeepStrictEqual(previous[key], value),
    )
  );
}
/** A stale worker cannot publish after another worker has acquired the lease. */
export class ModelWriter {
  private writes: Array<(tx: FirebaseFirestore.Transaction) => void> = [];
  count = 0;
  constructor(private readonly lease: RebuildLease) {}
  set(
    ref: DocumentReference,
    data: Record<string, unknown>,
    previous?: Record<string, unknown>,
    options?: SetOptions,
  ) {
    if (!changedFields(previous, data)) return;
    this.writes.push((tx) => (options ? tx.set(ref, data, options) : tx.set(ref, data)));
  }
  delete(ref: DocumentReference) {
    this.writes.push((tx) => tx.delete(ref));
  }
  async close(): Promise<void> {
    const db = getFirestore(),
      ref = db.doc(QUEUE_PATH);
    for (let i = 0; i < this.writes.length; i += 400) {
      const batch = this.writes.slice(i, i + 400);
      await db.runTransaction(async (tx) => {
        const lock = await tx.get(ref);
        if (
          lock.get("leaseToken") !== this.lease.token ||
          Number(lock.get("leaseUntil")) <= Date.now()
        ) {
          throw new Error("Read-model lease expired; the queued rebuild will retry.");
        }
        batch.forEach((write) => write(tx));
        tx.update(ref, {
          leaseUntil: Date.now() + 480_000,
          heartbeatAt: FieldValue.serverTimestamp(),
        });
      });
      this.count += batch.length;
    }
  }
}
