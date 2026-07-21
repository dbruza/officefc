/**
 * OfficeFC Cloud Functions — trusted writes that clients can't make directly.
 *
 * This is the deploy entry point: it initializes the Admin SDK once and re-exports
 * every callable. The handlers themselves live in focused domain modules.
 */
import { initializeApp } from "firebase-admin/app";

initializeApp();

// Membership & league setup
export { redeemInvite, ensureLeagueSetup } from "./membership";

// Season join codes
export { getSeasonJoinCode, rotateSeasonJoinCode } from "./joinCodes";

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
export { weeklySnapshot, sendReminders, cleanupAbandonedDrafts } from "./scheduled";

// Client log sink
export { ingestLog } from "./clientLogs";

// TEMPORARY one-off migration — remove after the join-code backfill has run (see #22).
export { backfillSeasonCodes } from "./migrations/backfillSeasonCodes";
