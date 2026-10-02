import { getPlayerStats } from "./standings";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { dataCache, invalidateData } from "../dataCache";
import type {
  SeasonSummary as StoredSeasonSummary,
  PlayerSummary,
} from "../../../../functions/src/models/summaries";
import { SUMMARY_VERSION } from "../../../../functions/src/models/version";
import type { BigResult } from "../stats/teamMeta";
import type { TeamRecordSummary } from "../teamRecord";

export type SeasonSummary = Omit<StoredSeasonSummary, "bigResults"> & { bigResults: BigResult[] };
export type ProfileSummary = PlayerSummary & { teamRecords: TeamRecordSummary };
async function ensure(input: { seasonId?: string; playerId?: string }) {
  const result = (
    await httpsCallable<typeof input, Record<string, unknown>>(
      functions,
      "ensurePerformanceSummary",
      { timeout: 550000 },
    )(input)
  ).data;
  invalidateData();
  return result;
}
export async function getSeasonSummary(seasonId: string): Promise<SeasonSummary> {
  return dataCache.read(
    `seasonSummary:${seasonId}`,
    async () => {
      const snap = await getDoc(doc(db, "seasonSummaries", seasonId));
      const raw = (
        snap.get("version") === SUMMARY_VERSION ? snap.data() : await ensure({ seasonId })
      ) as StoredSeasonSummary;
      return {
        ...raw,
        bigResults: raw.bigResults.map((m) => ({ ...m, date: m.date ? new Date(m.date) : null })),
      };
    },
    30000,
  );
}
export async function getProfileSummary(uid: string): Promise<ProfileSummary> {
  return dataCache.read(
    `profileSummary:${uid}`,
    async () => {
      const snap = await getDoc(doc(db, "playerStats", uid));
      const raw = (
        snap.get("summary.version") === SUMMARY_VERSION
          ? snap.get("summary")
          : await ensure({ playerId: uid })
      ) as PlayerSummary;
      const teams = raw.teams.map((team) => ({
        ...team,
        lastPlayed: team.lastPlayed ? new Date(team.lastPlayed) : null,
      }));
      return {
        ...raw,
        teamRecords: {
          teams,
          favourite: teams.find((t) => t.teamId === raw.favouriteId) ?? null,
          best: teams.find((t) => t.teamId === raw.bestId) ?? null,
        },
      };
    },
    10000,
  );
}
