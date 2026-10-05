import { randomUUID } from "node:crypto";
import { modelVersion } from "../rebuildQueue";
/**
 * LLM-powered match analysis.
 *
 * Gathers a confirmed match's committed numbers (score, ELO swing + explain breakdown,
 * extracted stats, season form, head-to-head), asks an OpenRouter free model for a
 * pundit-style analysis, validates the JSON, and caches it on the matchAnalysis doc so
 * each match is analysed at most once. Free models rotate and rate-limit, so the callable
 * walks a fallback CHAIN and, if every model fails, still returns a deterministic
 * analysis derived locally from the same numbers — the card never shows an error state.
 * Player names (and uids) never reach the model: the prompt calls them "Player A" / "Player B"
 * and restorePlayerNames puts the first names back into the answer before it is stored.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { loggedOnCall } from "../logging";
import { OMIT_UNLESS_AI, OPENROUTER_SECRET, openRouterApiKey } from "../config";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireAuth, assertMember } from "../auth";
import { callWithFallbackChain } from "./core/openrouter.mjs";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseAnalysis,
  restorePlayerNames,
} from "./core/prompt.mjs";
import { fallbackAnalysis } from "./core/fallback.mjs";

// Free-tier models rotate often; each is tried in order until one yields valid JSON.
// Keep this list short — every entry adds worst-case latency before the local fallback.
const MODEL_CHAIN = [
  "z-ai/glm-5.2:free",
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

const db = getFirestore();

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
const RATE_LIMIT_MAX = 30;

/** One season-form row for the prompt. */
interface FormRow {
  rank: number;
  w: number;
  d: number;
  l: number;
  streakText?: string;
}

export interface AnalysisPlayer {
  id: string;
  name: string;
}

/** The full context both the LLM prompt and the deterministic fallback consume. */
export interface AnalysisContext {
  match: {
    aGoals: number;
    bGoals: number;
    aTeam: string;
    bTeam: string;
    date: string | null;
    aEloBefore: number | null;
    aEloAfter: number | null;
    aDelta: number | null;
    bEloBefore: number | null;
    bEloAfter: number | null;
    bDelta: number | null;
    aStats: Record<string, number | null>;
    bStats: Record<string, number | null>;
  };
  playerA: AnalysisPlayer;
  playerB: AnalysisPlayer;
  seasonName: string | null;
  isFinals: boolean;
  eloExplain: {
    aExpected: number;
    bExpected: number;
    aTeamAdj: number;
    bTeamAdj: number;
    aPremierAdj: number;
    bPremierAdj: number;
    aK: number;
    bK: number;
  } | null;
  seasonForm: Record<string, FormRow> | null;
  headToHead: {
    games: number;
    aWins: number;
    bWins: number;
    draws: number;
    aGoals: number;
    bGoals: number;
    recent: Array<{ score: string; dateLabel?: string }>;
  } | null;
  h2hNames: { a: string; b: string } | null;
  /** Which player won the man-of-the-match vote (a side, not a name: the prompt is name-free). */
  mvpSide: "a" | "b" | null;
}

async function checkRateLimit(uid: string): Promise<void> {
  const ref = db.doc(`aiRateLimits/${uid}:analysis`);
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const timestamps: number[] = snap.exists ? (snap.get("timestamps") ?? []) : [];
    const recent = timestamps.filter((t: number) => t > windowStart);
    if (recent.length >= RATE_LIMIT_MAX) {
      throw new HttpsError(
        "resource-exhausted",
        `Rate limit reached. ${RATE_LIMIT_MAX} analyses per hour.`,
      );
    }
    recent.push(now);
    tx.set(ref, { timestamps: recent, updatedAt: FieldValue.serverTimestamp() });
  });
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function gatherAnalysisContext(
  matchId: string,
  data: FirebaseFirestore.DocumentData,
): Promise<AnalysisContext> {
  const aId = String(data.aId ?? ""),
    bId = String(data.bId ?? "");
  const seasonId = typeof data.seasonId === "string" ? data.seasonId : null;
  const pairKey = [aId, bId].sort().join("__");
  const [aProfile, bProfile, seasonSnap, standingsDocs, h2hSnap, votes] = await Promise.all([
    db.doc(`profiles/${aId}`).get(),
    db.doc(`profiles/${bId}`).get(),
    seasonId ? db.doc(`seasons/${seasonId}`).get() : Promise.resolve(null),
    seasonId
      ? db.getAll(
          db.doc(`seasons/${seasonId}/standings/${aId}`),
          db.doc(`seasons/${seasonId}/standings/${bId}`),
        )
      : Promise.resolve([]),
    db.doc(`h2h/${pairKey}`).get(),
    db.doc(`matchVotes/${matchId}/votes/_summary`).get(),
  ]);
  const nameOf = (uid: string, snapshot: FirebaseFirestore.DocumentSnapshot) => {
    const name = snapshot.get("displayName");
    return typeof name === "string" && name ? name.split(" ")[0] : uid;
  };
  const leader = votes.get("leaderId");
  const mvpSide = leader === aId ? "a" : leader === bId ? "b" : null;
  const seasonForm: Record<string, FormRow> = {};
  if (standingsDocs.length) {
    for (const doc of standingsDocs.filter((row) => row.exists)) {
      const uid = doc.id;
      const w = num(doc.get("w")) ?? 0;
      const d = num(doc.get("d")) ?? 0;
      const l = num(doc.get("l")) ?? 0;
      const row: FormRow = { rank: num(doc.get("rank")) ?? 0, w, d, l };
      const form = doc.get("form");
      if (Array.isArray(form) && form.length >= 2) {
        const wins = form.filter((r) => r === "W").length;
        if (wins === form.length) row.streakText = `${form.length}-game win streak`;
        else if (wins === 0) row.streakText = `winless in their last ${form.length}`;
      }
      seasonForm[uid] = row;
    }
  }

  const rawH2h = h2hSnap.exists ? (h2hSnap.data() ?? {}) : null;
  const meetings = Array.isArray(rawH2h?.meetings) ? rawH2h.meetings : [];
  // Totals describe the current read model. The separately listed meetings exclude this match.
  const priorMeetings = meetings
    .filter((m: Record<string, unknown>) => typeof m.matchId !== "string" || m.matchId !== matchId)
    .slice(0, 3);

  const nameA = nameOf(aId, aProfile);
  const nameB = nameOf(bId, bProfile);
  // Whose column is which in the stored h2h doc follows the SORTED uid order, not A/B of
  // this fixture; re-map so the prompt always reads left-to-right as A then B.
  const h2hIsReversed = [aId, bId].sort()[0] !== aId;

  const explain = (data.eloExplain ?? null) as AnalysisContext["eloExplain"];

  const statsOf = (side: "a" | "b"): Record<string, number | null> => {
    const nested = data[`${side}Stats`];
    if (nested && typeof nested === "object") {
      const s = nested as Record<string, unknown>;
      return {
        possession: num(s.possession),
        shots: num(s.shots),
        shotsOnTarget: num(s.shotsOnTarget),
        xg: num(s.xg),
      };
    }
    return {
      possession: num(data[`${side}Possession`]),
      shots: num(data[`${side}Shots`]),
      shotsOnTarget: num(data[`${side}ShotsOnTarget`]),
      xg: num(data[`${side}Xg`]),
    };
  };

  const dateVal = data.date;
  return {
    match: {
      aGoals: num(data.aGoals) ?? 0,
      bGoals: num(data.bGoals) ?? 0,
      aTeam: String(data.aTeam ?? ""),
      bTeam: String(data.bTeam ?? ""),
      date:
        dateVal && typeof dateVal.toDate === "function"
          ? dateVal.toDate().toISOString().slice(0, 10)
          : null,
      aEloBefore: num(data.aEloBefore),
      aEloAfter: num(data.aEloAfter),
      aDelta: num(data.aDelta),
      bEloBefore: num(data.bEloBefore),
      bEloAfter: num(data.bEloAfter),
      bDelta: num(data.bDelta),
      aStats: statsOf("a"),
      bStats: statsOf("b"),
    },
    playerA: { id: aId, name: nameA },
    playerB: { id: bId, name: nameB },
    seasonName:
      seasonSnap && seasonSnap.exists
        ? ((seasonSnap.get("name") as string | undefined) ?? null)
        : null,
    isFinals: data.finals === true,
    eloExplain: explain,
    seasonForm,
    headToHead:
      rawH2h && typeof rawH2h.aWins === "number"
        ? {
            games: Math.max(
              0,
              Number(rawH2h.aWins ?? 0) + Number(rawH2h.draws ?? 0) + Number(rawH2h.bWins ?? 0),
            ),
            aWins: h2hIsReversed ? Number(rawH2h.bWins ?? 0) : Number(rawH2h.aWins ?? 0),
            bWins: h2hIsReversed ? Number(rawH2h.aWins ?? 0) : Number(rawH2h.bWins ?? 0),
            draws: Number(rawH2h.draws ?? 0),
            aGoals: h2hIsReversed ? Number(rawH2h.bGoals ?? 0) : Number(rawH2h.aGoals ?? 0),
            bGoals: h2hIsReversed ? Number(rawH2h.aGoals ?? 0) : Number(rawH2h.bGoals ?? 0),
            recent: priorMeetings.map((m: Record<string, unknown>) => ({
              score: h2hIsReversed
                ? `${Number(m.bGoals)}-${Number(m.aGoals)}`
                : `${Number(m.aGoals)}-${Number(m.bGoals)}`,
              dateLabel:
                m.date && typeof (m.date as { toMillis?: unknown }).toMillis === "function"
                  ? new Date((m.date as { toMillis: () => number }).toMillis())
                      .toISOString()
                      .slice(0, 10)
                  : undefined,
            })),
          }
        : null,
    h2hNames: { a: nameA, b: nameB },
    mvpSide,
  };
}

export const analyzeMatch = loggedOnCall(
  "analyzeMatch",
  { cors: true, secrets: [OPENROUTER_SECRET], timeoutSeconds: 120, omit: OMIT_UNLESS_AI },
  async (req) => {
    const { uid } = requireAuth(req);
    await assertMember(uid);
    const matchId = String(req.data?.matchId ?? "").trim();
    if (!matchId || matchId.includes("/"))
      throw new HttpsError("invalid-argument", "A match id is required.");
    await modelVersion();
    const match = await db.doc(`matches/${matchId}`).get();
    if (!match.exists || match.get("status") !== "confirmed")
      throw new HttpsError("failed-precondition", "Only confirmed matches can be analysed.");
    const sourceVersion =
      (match.get("recalculatedAt") ?? match.get("confirmedAt"))?.toMillis?.() ?? 0;
    const ref = db.doc(`matchAnalysis/${matchId}`),
      token = randomUUID();
    const cached = await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.get("status") === "ready" && current.get("sourceVersion") === sourceVersion)
        return current.data()!;
      if (current.get("status") === "processing" && Number(current.get("leaseUntil")) > Date.now())
        throw new HttpsError(
          "aborted",
          "This analysis is already being prepared. Try again shortly.",
        );
      tx.set(ref, { status: "processing", token, leaseUntil: Date.now() + 90000, sourceVersion });
      return null;
    });
    if (cached) return { cached: true, ...cached };
    try {
      await checkRateLimit(uid);
      const ctx = await gatherAnalysisContext(matchId, match.data()!);
      let analysis: ReturnType<typeof parseAnalysis>, model: string;
      try {
        const result = await callWithFallbackChain({
          models: MODEL_CHAIN,
          apiKey: openRouterApiKey(),
          timeoutMs: 8000,
          maxAttempts: 1,
          deadlineMs: Date.now() + 30000,
          requestOpts: { systemPrompt: SYSTEM_PROMPT, userPrompt: buildUserPrompt(ctx) },
          validate: parseAnalysis,
        });
        analysis = restorePlayerNames(result.content as ReturnType<typeof parseAnalysis>, {
          a: ctx.playerA.name,
          b: ctx.playerB.name,
        });
        model = result.model;
      } catch (error) {
        console.warn(
          JSON.stringify({
            severity: "WARNING",
            message: "analysis_llm_chain_failed",
            matchId,
            error: String(error),
          }),
        );
        analysis = fallbackAnalysis(ctx);
        model = "fallback";
      }
      const record = {
        status: "ready",
        ...analysis,
        model,
        sourceVersion,
        analysedAt: FieldValue.serverTimestamp(),
      };
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (current.get("token") !== token)
          throw new HttpsError("aborted", "Analysis was superseded.");
        tx.set(ref, record);
      });
      return { cached: false, ...record };
    } catch (error) {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (current.get("token") === token) tx.delete(ref);
      });
      throw error;
    }
  },
);
