import { dataCache } from "../dataCache";
import { collection, doc, getDoc, getDocs, query, where, documentId } from "firebase/firestore";
import { auth, db } from "../firebase";
import { timed } from "../logger";
import { LEAGUE_ID } from "../constants";
import type { Role } from "../profiles";
import type { LeaguePlayer } from "./types";
import {
  BLOCKED_PLAYER_NAME,
  blockListOf,
  memberStatusOf,
  type MemberStatus,
} from "../../../../functions/src/models/safety";

/** The signed-in user's block list. A missing doc (or a failed read) means nobody. */
export async function getBlockedIds(): Promise<Set<string>> {
  const uid = auth.currentUser?.uid;
  if (!uid) return new Set();
  try {
    const snap = await getDoc(doc(db, "userBlocks", uid));
    return new Set(blockListOf(snap.data()));
  } catch {
    return new Set();
  }
}

/**
 * Every member, including removed and account-deleted ones, so old results still resolve
 * to a name. Players the viewer blocked come back masked. Use canPlayAgainst before
 * offering someone as an opponent.
 */
export async function getLeaguePlayers(): Promise<LeaguePlayer[]> {
  return dataCache.read(
    "roster",
    async () => {
      return timed("getLeaguePlayers", async () => {
        const [memberSnap, blocked] = await Promise.all([
          getDocs(collection(db, "leagues", LEAGUE_ID, "members")),
          getBlockedIds(),
        ]);
        const ids = memberSnap.docs.map((member) => member.id);
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
        const profiles = await Promise.all(
          chunks.map((chunk) =>
            getDocs(query(collection(db, "profiles"), where(documentId(), "in", chunk))),
          ),
        );
        const profileSnap = { docs: profiles.flatMap((snapshot) => snapshot.docs) };
        const roles = new Map(memberSnap.docs.map((doc) => [doc.id, doc.get("role") as Role]));
        const statuses = new Map<string, MemberStatus>(
          memberSnap.docs.map((doc) => [doc.id, memberStatusOf(doc.data())]),
        );

        return profileSnap.docs
          .filter((doc) => roles.has(doc.id))
          .map((doc) => {
            const data = doc.data();
            const isBlocked = blocked.has(doc.id);
            return {
              id: doc.id,
              name: isBlocked ? BLOCKED_PLAYER_NAME : String(data.displayName),
              handle: isBlocked ? "" : String(data.handle ?? ""),
              jersey: Number(data.jersey ?? 0),
              color: String(data.color ?? "#00ff87"),
              role: roles.get(doc.id) ?? "member",
              status: statuses.get(doc.id) ?? "active",
              blocked: isBlocked,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
      });
    },
    300000,
  );
}

/** Whether a new match can be recorded against this player. */
export function canPlayAgainst(player: LeaguePlayer): boolean {
  return player.status === "active" && !player.blocked;
}
