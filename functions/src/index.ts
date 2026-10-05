/**
 * OfficeFC Cloud Functions — trusted writes that clients can't make directly.
 *
 * This is the deploy entry point: it initializes the Admin SDK once and re-exports
 * every callable. The handlers themselves live in focused domain modules.
 */
// Sentry first so its handlers exist before any domain module loads.
import "./sentry";
import { initializeApp } from "firebase-admin/app";

initializeApp();

// Membership & league setup
export { redeemInvite, ensureLeagueSetup } from "./membership";

// Season join codes
export { getSeasonJoinCode, rotateSeasonJoinCode } from "./joinCodes";

// In-app account deletion
export { deleteAccount } from "./account";

// Player safety: reports, blocks, admin moderation, offensive-name screen
export {
  reportPlayer,
  setPlayerBlocked,
  resolveReport,
  moderateMember,
  screenProfileName,
} from "./safety";

// Team catalogue sync
export { seedTeams } from "./teams";

// Match lifecycle
export {
  confirmMatch,
  disputeMatch,
  notifyMatchSubmitted,
  deleteMatchPhoto,
} from "./matchLifecycle";

// Auto-matchup fixtures (system-dealt teams)
export { createFixture, consumeFixture } from "./fixtures";

// Finals series (bracket lock, walkovers)
export { startFinals, awardWalkover } from "./finals";

// Per-match MVP peer voting
export { castVote } from "./matchVotes";

// Mid-season knockout cup
export { startCup, forceAdvanceCup, announceCupChampion } from "./cup";

// Read-model rebuild (ELO + stats materialization)
export { rebuildLeagueReadModels } from "./readModels";

// AI extraction
export { extractMatchStats } from "./extract/extractMatchStats";
export { abandonMatchDraft } from "./extract/abandonMatchDraft";
export { getMatchPhotoUrl } from "./extract/getMatchPhotoUrl";
export { submitAiAssistedMatch } from "./extract/submitAiAssistedMatch";

// Season lifecycle & admin
export {
  finalizeSeason,
  createSeason,
  activateSeason,
  manageTeam,
  resolveMatch,
  listSeasons,
} from "./seasonAdmin";

// Scheduled jobs
export {
  weeklySnapshot,
  sendReminders,
  cleanupAbandonedDrafts,
  autoConfirmStaleMatches,
} from "./scheduled";

// Client log sink
export { ingestLog } from "./clientLogs";

// TEMPORARY one-off migration — remove after the join-code backfill has run (see #22).
export { backfillSeasonCodes } from "./migrations/backfillSeasonCodes";

export { rebuildQueuedModels, recoverQueuedModels } from "./rebuildQueue";

export { deliverNotification, retryNotifications } from "./notify";

export { ensurePerformanceSummary, refreshCatalogueModels } from "./performanceSummary";

export { analyzeMatch } from "./matchAnalysis/analyzeMatch";
