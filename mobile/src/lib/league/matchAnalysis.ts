/**
 * LLM match analysis (client side).
 *
 * Reads are member-wide from `matchAnalysis/{matchId}` (rules: members read,
 * functions write); the `analyzeMatch` callable generates-or-returns-cached, so
 * calling it on an already-analysed match is one Firestore read and cheap.
 */
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

export type SurpriseLevel = "expected" | "mild_upset" | "shock";

export interface MatchAnalysis {
  headline: string;
  summary: string;
  surpriseLevel: SurpriseLevel;
  surpriseNote: string;
  ratingStory: string;
  talkingPoints: string[];
  /** Which model produced it — "fallback" when every LLM in the chain failed. */
  model: string | null;
}

/** Map a raw doc/callable payload to the UI shape; tolerant of pre-schema docs. */
export function mapAnalysis(raw: Record<string, unknown>): MatchAnalysis {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const level = raw.surpriseLevel;
  return {
    headline: str(raw.headline),
    summary: str(raw.summary),
    surpriseLevel:
      level === "shock" || level === "mild_upset" ? level : ("expected" as SurpriseLevel),
    surpriseNote: str(raw.surpriseNote),
    ratingStory: str(raw.ratingStory),
    talkingPoints: Array.isArray(raw.talkingPoints)
      ? raw.talkingPoints.filter((p): p is string => typeof p === "string").slice(0, 3)
      : [],
    model: typeof raw.model === "string" ? raw.model : null,
  };
}

/**
 * The cached analysis for a confirmed match, or null when none exists yet. A read
 * failure degrades to null so the card simply stays hidden — same discipline as votes.
 */
export async function getCachedAnalysis(matchId: string): Promise<MatchAnalysis | null> {
  const [snap, match] = await Promise.all([
    getDoc(doc(db, "matchAnalysis", matchId)),
    getDoc(doc(db, "matches", matchId)),
  ]).catch(() => [null, null]);
  if (
    !snap ||
    !match ||
    !snap.exists() ||
    snap.get("status") !== "ready" ||
    match.get("status") !== "confirmed"
  )
    return null;
  const version = (match.get("recalculatedAt") ?? match.get("confirmedAt"))?.toMillis?.() ?? 0;
  if (snap.get("sourceVersion") !== version) return null;
  return mapAnalysis(snap.data());
}

/**
 * Ask the backend to analyse (or return its cached analysis for) this match.
 * Throws on transport failure; callers decide how to degrade.
 */
export async function requestAnalysis(matchId: string): Promise<MatchAnalysis> {
  const callable = httpsCallable<{ matchId: string }, Record<string, unknown>>(
    functions,
    "analyzeMatch",
    { timeout: 65000 },
  );
  const result = await callable({ matchId });
  return mapAnalysis(result.data);
}
