import { dataCache } from "../dataCache";
import { collection, getDocs, query, where, documentId } from "firebase/firestore";
import { db } from "../firebase";
import { timed } from "../logger";
import { LEAGUE_ID } from "../constants";
import type { Role } from "../profiles";
import type { LeaguePlayer } from "./types";

export async function getLeaguePlayers(): Promise<LeaguePlayer[]> {
  return dataCache.read(
    "roster",
    async () => {
      return timed("getLeaguePlayers", async () => {
        const memberSnap = await getDocs(collection(db, "leagues", LEAGUE_ID, "members"));
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
      });
    },
    300000,
  );
}
