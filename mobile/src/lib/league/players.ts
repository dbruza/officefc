import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { LEAGUE_ID } from "../constants";
import type { Role } from "../profiles";
import type { LeaguePlayer } from "./types";

export async function getLeaguePlayers(): Promise<LeaguePlayer[]> {
  const [memberSnap, profileSnap] = await Promise.all([
    getDocs(collection(db, "leagues", LEAGUE_ID, "members")),
    getDocs(collection(db, "profiles")),
  ]);
  const roles = new Map(memberSnap.docs.map((doc) => [doc.id, doc.get("role") as Role]));

  return profileSnap.docs
    .filter((doc) => roles.has(doc.id))
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: String(data.displayName),
        handle: String(data.handle ?? ""),
        jersey: Number(data.jersey ?? 0),
        color: String(data.color ?? "#00ff87"),
        role: roles.get(doc.id) ?? "member",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
