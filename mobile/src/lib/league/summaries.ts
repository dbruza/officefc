import { getPlayerStats } from "./standings";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { dataCache } from "../dataCache";
import type {
  SeasonSummary as StoredSeasonSummary,
  PlayerSummary,
} from "../../../../functions/src/models/summaries";
import { SUMMARY_VERSION } from "../../../../functions/src/models/version";
import type { BigResult } from "../stats/teamMeta";
import type { TeamRecordSummary } from "../teamRecord";

export type SeasonSummary = Omit<StoredSeasonSummary, "bigResults"> & { bigResults: BigResult[] };
export type ProfileSummary = PlayerSummary & { teamRecords: TeamRecordSummary };

/**
 * A stored summary is usable when it is at least as new as this build. Summary versions
 * only add fields, and the server is deployed ahead of store builds, so an older app must
 * accept a newer summary instead of asking the server to "upgrade" it.
 */
export function isCurrentSummary(version: unknown): boolean {
  return typeof version === "number" && version >= SUMMARY_VERSION;
}

/**
 * Bootstrap a missing or outdated summary on the server and use what it returns.
 *
 * This deliberately does not invalidate the data cache: it runs inside a screen's fetch,
 * and invalidating there throws that fetch's result away and starts it again. Whenever
 * the server's summary version differed from this build's, every retry asked again,
 * so screens built on summaries (profile, games, seasons, stats) never finished loading.
 * Other cached reads expire within seconds on their own.
 */
async function ensure(input: { seasonId?: string; playerId?: string }) {
  return (
    await httpsCallable<typeof input, Record<string, unknown>>(
      functions,
      "ensurePerformanceSummary",
      { timeout: 550000 },
    )(input)
  ).data;
}
export async function getSeasonSummary(seasonId: string): Promise<SeasonSummary> {
  return dataCache.read(
    `seasonSummary:${seasonId}`,
    async () => {
      const snap = await getDoc(doc(db, "seasonSummaries", seasonId));
      const raw = (
        isCurrentSummary(snap.get("version")) ? snap.data() : await ensure({ seasonId })
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
        isCurrentSummary(snap.get("summary.version"))
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
