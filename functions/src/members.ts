import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { LEAGUE_ID } from "./config";
import { blockListOf, memberStatusOf } from "./models/safety";

interface MemberSnapshot {
  exists: boolean;
  get(field: string): unknown;
}

/** Removed and account-deleted members keep a doc (so history resolves) but lose access. */
export function isActiveMember(snap: MemberSnapshot): boolean {
  return snap.exists && memberStatusOf({ status: snap.get("status") }) === "active";
}

/** Ids of members who can still play: draws, fixtures and pickers skip everyone else. */
export function activeMemberIds(docs: Array<MemberSnapshot & { id: string }>): string[] {
  return docs.filter(isActiveMember).map((doc) => doc.id);
}

export function memberRef(uid: string) {
  return getFirestore().doc(`leagues/${LEAGUE_ID}/members/${uid}`);
}

export function userBlocksRef(uid: string) {
  return getFirestore().doc(`userBlocks/${uid}`);
}

export const BLOCKED_MATCH_MESSAGE =
  "You can't record matches with this player because one of you has blocked the other.";

/** True when either player has blocked the other — they can't record matches together. */
export async function isBlockedBetween(a: string, b: string, tx?: Transaction): Promise<boolean> {
  const refs = [userBlocksRef(a), userBlocksRef(b)];
  const [aBlocks, bBlocks] = tx ? await tx.getAll(...refs) : await getFirestore().getAll(...refs);
  return blockListOf(aBlocks.data()).includes(b) || blockListOf(bBlocks.data()).includes(a);
}
