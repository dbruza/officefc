// ESM (.mjs) on purpose: imported directly by the root `node --test` suite and compiled by functions tsc. Do not rename to .js.
/* OfficeFC — validation & normalization of the raw model output.
   This is the trust layer: it turns whatever the model returned into a normalized,
   human-reviewable suggestion and decides when a human MUST review before submit.
   It deliberately does NOT map sides to players — the app does that (the photo can't
   tell who played, only left vs right). */

import { checkScoreConsistency, deriveShotsOnTarget } from "./statsCheck.mjs";

const CONFIDENCE_FLOOR = 0.6; // below this we force manual review

const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Coerce to a non-negative integer, or null. Accepts numeric strings like "3". */
function toCount(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.trim()) : v;
  if (!isFiniteNum(n)) return null;
  const i = Math.round(n);
  return i < 0 ? null : i;
}

/** Coerce to a 0–100 percentage, or null. */
function toPct(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace("%", "").trim()) : v;
  if (!isFiniteNum(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/** Ball Recovery Time reads above this (seconds) are misreads, not a real match. */
const RECOVERY_MAX_SECONDS = 120;

/** Coerce a Ball Recovery Time read: non-negative seconds (decimals kept), else null. */
function toSeconds(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/s$/i, "").trim()) : v;
  if (!isFiniteNum(n) || n < 0 || n > RECOVERY_MAX_SECONDS) return null;
  return n;
}

/** Plausible ceiling for a single side's xG on a video-game scoreline. */
const XG_MAX = 15;

/** Coerce xG: keeps decimals (unlike toCount), non-negative, clamped when implausible. */
function toXg(v) {
  if (v === null || v === undefined || v === "") return { value: null };
  const n = typeof v === "string" ? Number(String(v).trim()) : v;
  if (!isFiniteNum(n) || n < 0) return { value: null };
  if (n > XG_MAX) return { value: XG_MAX, clamped: true };
  return { value: n };
}

function normalizeSide(side, label, flags) {
  const s = side || {};
  const goals = toCount(s.goals);
  let shots = toCount(s.shots);
  let sot = toCount(s.shots_on_target);
  const possession = toPct(s.possession);
  const shot_accuracy = toPct(s.shot_accuracy);
  const saves = toCount(s.saves);
  const ball_recovery_time = toSeconds(s.ball_recovery_time);
  const xgRead = toXg(s.xg);
  let xg = xgRead.value;
  const team_name =
    typeof s.team_name === "string" && s.team_name.trim() ? s.team_name.trim() : null;

  if (goals === null) flags.push(`${label}_goals_unreadable`);
  // shots on target cannot exceed total shots
  if (shots !== null && sot !== null && sot > shots) {
    flags.push(`${label}_sot_gt_shots`);
    sot = shots;
  }
  // An absurd xG read is clamped and flagged so the human review sees it.
  if (xgRead.clamped) {
    flags.push(`${label}_xg_implausible`);
    xg = xgRead.value;
  }
  // FC 24+ summary screens don't print shots on target; recover it from the Shot Accuracy panel.
  const sotRead = deriveShotsOnTarget({ shots, shots_on_target: sot, shot_accuracy });
  return {
    team_name,
    goals,
    possession,
    shots,
    shots_on_target: sotRead.value,
    shots_on_target_source: sotRead.source,
    xg,
    shot_accuracy,
    saves,
    ball_recovery_time,
  };
}

/**
 * Normalize a raw report_match_stats object from the model.
 * @returns {{
 *   ok: boolean, reason?: string, detectedScreen: boolean, confidence: number,
 *   requiresReview: boolean, flags: string[],
 *   consistency?: ReturnType<typeof checkScoreConsistency>,
 *   suggestion: null | { home: object, away: object, homeResult: 'W'|'D'|'L'|null }
 * }}
 */
export function normalizeExtraction(raw) {
  const flags = [];
  const detectedScreen = raw && raw.detected_screen === true;
  const confidence = isFiniteNum(raw && raw.confidence)
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0;

  // Not a stats screen → tell the app to fall back to manual entry.
  if (!detectedScreen) {
    return {
      ok: false,
      reason: "not_a_stats_screen",
      detectedScreen: false,
      confidence,
      requiresReview: true,
      flags: ["not_a_stats_screen"],
      suggestion: null,
    };
  }

  const home = normalizeSide(raw.home, "home", flags);
  const away = normalizeSide(raw.away, "away", flags);

  // Goals vs shots on target − the other keeper's saves: a disagreement means the score (the
  // value ELO leans on most) was probably misread, so the player must check it.
  const consistency = checkScoreConsistency(home, away);
  if (consistency.status === "mismatch") flags.push("score_stats_mismatch");

  // Possession should add up to ~100 when both are present.
  if (home.possession !== null && away.possession !== null) {
    if (Math.abs(home.possession + away.possession - 100) > 3) flags.push("possession_sum_off");
  }

  // Result from the home perspective (only when both scores are known).
  let homeResult = null;
  if (home.goals !== null && away.goals !== null) {
    homeResult = home.goals > away.goals ? "W" : home.goals < away.goals ? "L" : "D";
  }

  const goalsMissing = home.goals === null || away.goals === null;
  const lowConfidence = confidence < CONFIDENCE_FLOOR;
  const requiresReview = goalsMissing || lowConfidence || flags.length > 0;
  if (lowConfidence) flags.push("low_confidence");

  return {
    ok: true,
    detectedScreen: true,
    confidence,
    requiresReview,
    flags,
    consistency,
    suggestion: { home, away, homeResult },
  };
}

export const _internals = {
  toCount,
  toPct,
  toXg,
  toSeconds,
  XG_MAX,
  RECOVERY_MAX_SECONDS,
  CONFIDENCE_FLOOR,
};
