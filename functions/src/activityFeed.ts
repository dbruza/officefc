/**
 * IO layer for the activity feed: reads the inputs the pure activity.ts derivation needs,
 * then persists the events to the member-readable `activity` collection with deterministic
 * document IDs (so a re-run can never duplicate an event).
 */
import { getFirestore, FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { LEAGUE_ID } from "./config";
import {
  deriveFinalsResultActivity,
  deriveFinalsSetActivity,
  deriveMatchActivity,
  deriveSeasonActivity,
  matchActivityIds,
  type ActivityEvent,
  type FinalsResultActivityInput,
  type FinalsSetActivityInput,
  type SeasonActivityInput,
} from "./activity";

/** The season's current rank-1 ranked player, or null if nobody has qualified yet. */
export async function topRankedLeaderId(db: Firestore, seasonId: string): Promise<string | null> {
  const snap = await db
    .collection(`seasons/${seasonId}/standings`)
    .where("rank", "==", 1)
    .where("ranked", "==", true)
    .limit(1)
    .get();
  for (const doc of snap.docs) {
    if (doc.get("rank") === 1 && doc.get("ranked") === true) return doc.id;
  }
  return null;
}

/**
 * Persist derived events. Idempotent: deterministic IDs plus `create`-then-skip-if-exists
 * means a re-run (or the backfill racing a live write) never duplicates or reorders an event.
 * `createdAt` defaults to the server clock (live emit); the backfill passes the match time.
 */
function activityDoc(event: ActivityEvent, createdAt: Timestamp | FieldValue) {
  return {
    type: event.type,
    leagueId: LEAGUE_ID,
    seasonId: event.seasonId,
    actorIds: event.actorIds,
    payload: event.payload,
    createdAt,
  };
}

async function writeActivityEvents(
  db: Firestore,
  events: ActivityEvent[],
  createdAt: Timestamp | FieldValue = FieldValue.serverTimestamp(),
): Promise<void> {
  await Promise.all(
    events.map(async (event) => {
      const ref = db.doc(`activity/${event.id}`);
      try {
        await ref.create(activityDoc(event, createdAt));
      } catch (error) {
        if ((error as { code?: number }).code !== 6) throw error;
      }
    }),
  );
}

/**
 * Emit the feed events for one just-confirmed match. Call AFTER recalcSeasonElo +
 * recalcLeagueStats so the match deltas and winner streak are materialized. The caller
 * must capture `previousLeaderId` BEFORE the recalc so lead changes can be detected.
 */
export async function emitMatchActivity(args: {
  db?: Firestore;
  matchId: string;
  seasonId: string;
  previousLeaderId: string | null;
  /**
   * Skip this match's streak milestone. Streaks are read from the materialized playerStats, so
   * when several of one player's matches are confirmed together they all observe the same
   * post-batch streak — without this the same milestone is filed once per match.
   */
  suppressStreak?: boolean;
}): Promise<void> {
  const db = args.db ?? getFirestore();
  const snap = await db.doc(`matches/${args.matchId}`).get();
  if (!snap.exists) return;
  const data = snap.data()!;
  if (data.status !== "confirmed") return;

  const aGoals = Number(data.aGoals);
  const bGoals = Number(data.bGoals);
  const winnerId = aGoals > bGoals ? String(data.aId) : bGoals > aGoals ? String(data.bId) : null;

  let winnerStreak: number | null = null;
  let winnerStreakType: "W" | "D" | "L" | null = null;
  if (winnerId && typeof data.winnerStreakAfter === "number") {
    winnerStreak = data.winnerStreakAfter;
    winnerStreakType = "W";
  } else if (winnerId && !args.suppressStreak) {
    const statsSnap = await db.doc(`playerStats/${winnerId}`).get();
    if (statsSnap.exists) {
      const streak = statsSnap.get("currentStreak");
      const streakType = statsSnap.get("currentStreakType");
      winnerStreak = typeof streak === "number" ? streak : null;
      winnerStreakType =
        streakType === "W" || streakType === "D" || streakType === "L" ? streakType : null;
    }
  }

  const hasTransition = "leaderBeforeId" in data && "leaderAfterId" in data;
  const previousLeaderId = hasTransition ? data.leaderBeforeId : args.previousLeaderId;
  const newLeaderId = hasTransition
    ? data.leaderAfterId
    : await topRankedLeaderId(db, args.seasonId);

  const events = deriveMatchActivity({
    matchId: args.matchId,
    seasonId: args.seasonId,
    aId: String(data.aId),
    bId: String(data.bId),
    aGoals,
    bGoals,
    aEloBefore: Number(data.aEloBefore ?? 0),
    bEloBefore: Number(data.bEloBefore ?? 0),
    aDelta: Number(data.aDelta ?? 0),
    bDelta: Number(data.bDelta ?? 0),
    winnerStreak,
    winnerStreakType,
    previousLeaderId,
    newLeaderId,
  });
  await writeActivityEvents(db, events);
}

/**
 * Re-derive the feed events of every confirmed result in a season dated at or after a voided
 * one, from the fields the rebuild just recalculated. Call AFTER recalcSeasonElo. Each of those
 * results' rating moves, leader changes and streaks was computed with the voided result in
 * the table, and feed events are written once, at confirmation, so without this the feed keeps
 * the old numbers. Events a result no longer produces are removed; the rest keep their
 * original time, so the feed's order doesn't change.
 */
export async function replayActivityAfterVoid(
  db: Firestore,
  seasonId: string,
  voidedMatchId: string,
): Promise<number> {
  const voided = await db.doc(`matches/${voidedMatchId}`).get();
  const voidedDate = voided.get("date");
  const later = await db
    .collection("matches")
    .where("seasonId", "==", seasonId)
    .where("status", "==", "confirmed")
    .where("date", ">=", voidedDate instanceof Timestamp ? voidedDate : Timestamp.fromMillis(0))
    .get();
  // Finals have their own bracket events and never move ratings.
  const rows = later.docs.filter((row) => row.get("finals") !== true);
  if (rows.length === 0) return 0;

  const refsByMatch = rows.map((row) =>
    matchActivityIds(row.id, String(row.get("aId")), String(row.get("bId"))).map((id) =>
      db.doc(`activity/${id}`),
    ),
  );
  const flat = refsByMatch.flat();
  const existing = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  for (let i = 0; i < flat.length; i += 300) {
    for (const snap of await db.getAll(...flat.slice(i, i + 300))) existing.set(snap.id, snap);
  }

  const writer = db.bulkWriter();
  rows.forEach((row, index) => {
    const data = row.data();
    const aGoals = Number(data.aGoals);
    const bGoals = Number(data.bGoals);
    const decided = aGoals !== bGoals && typeof data.winnerStreakAfter === "number";
    const events = deriveMatchActivity({
      matchId: row.id,
      seasonId,
      aId: String(data.aId),
      bId: String(data.bId),
      aGoals,
      bGoals,
      aEloBefore: Number(data.aEloBefore ?? 0),
      bEloBefore: Number(data.bEloBefore ?? 0),
      aDelta: Number(data.aDelta ?? 0),
      bDelta: Number(data.bDelta ?? 0),
      winnerStreak: decided ? data.winnerStreakAfter : null,
      winnerStreakType: decided ? "W" : null,
      previousLeaderId: typeof data.leaderBeforeId === "string" ? data.leaderBeforeId : null,
      newLeaderId: typeof data.leaderAfterId === "string" ? data.leaderAfterId : null,
    });
    const derived = new Set(events.map((event) => event.id));
    // An event the result didn't have before slots in at the time its result was announced.
    const announcedAt =
      existing.get(`result_${row.id}`)?.get("createdAt") ??
      (data.date instanceof Timestamp ? data.date : FieldValue.serverTimestamp());
    for (const event of events) {
      const createdAt = existing.get(event.id)?.get("createdAt") ?? announcedAt;
      writer.set(db.doc(`activity/${event.id}`), activityDoc(event, createdAt));
    }
    for (const ref of refsByMatch[index]) {
      if (!derived.has(ref.id) && existing.get(ref.id)?.exists) writer.delete(ref);
    }
  });
  await writer.close();
  return rows.length;
}

/** Emit champion + premier + per-month POTM events when a season is finalized. */
export async function emitSeasonActivity(
  input: SeasonActivityInput,
  db?: Firestore,
): Promise<void> {
  const events = deriveSeasonActivity(input);
  await writeActivityEvents(db ?? getFirestore(), events);
}

/** Emit the bracket-locked announcement when finals start. */
export async function emitFinalsSetActivity(
  input: FinalsSetActivityInput,
  db?: Firestore,
): Promise<void> {
  await writeActivityEvents(db ?? getFirestore(), deriveFinalsSetActivity(input));
}

/** Emit the result event for one decided finals tie. */
export async function emitFinalsResultActivity(
  input: FinalsResultActivityInput,
  db?: Firestore,
): Promise<void> {
  await writeActivityEvents(db ?? getFirestore(), deriveFinalsResultActivity(input));
}

/** Backfill a single match's result event with its own timestamp; skips if it already exists. */
export async function backfillMatchResult(
  db: Firestore,
  match: {
    id: string;
    seasonId: string;
    aId: string;
    bId: string;
    aGoals: number;
    bGoals: number;
    aDelta: number;
    bDelta: number;
  },
  createdAtMillis: number,
): Promise<void> {
  const events = deriveMatchActivity({
    ...match,
    matchId: match.id,
    aEloBefore: 0,
    bEloBefore: 0,
    winnerStreak: null,
    winnerStreakType: null,
    previousLeaderId: null,
    newLeaderId: null,
  }).filter((event) => event.type === "match_result");
  await writeActivityEvents(db, events, Timestamp.fromMillis(createdAtMillis));
}
