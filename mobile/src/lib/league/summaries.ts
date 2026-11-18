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
 * A bootstrap rebuilds the league's projections (player stats, standings, ELO history),
 * and the screen asking for it may have read those in parallel from before the rebuild.
 * Invalidating makes the screen drop that fetch and run it once more against the rebuilt
 * data. That only happens when the server returned a summary this build accepts: the
 * retry then reads it straight from Firestore without calling back here. When it doesn't
 * (a server older than this build), invalidating would retry forever. That loop is what
 * kept profile, games, seasons and stats screens loading forever on build 20.
 */
async function ensure(input: { seasonId?: string; playerId?: string }) {
  const result = (
    await httpsCallable<typeof input, Record<string, unknown>>(
      functions,
      "ensurePerformanceSummary",
      { timeout: 550000 },
    )(input)
  ).data;
  if (isCurrentSummary(result?.version)) invalidateData();
  return result;
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
