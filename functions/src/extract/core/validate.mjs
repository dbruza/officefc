/* OfficeFC — validation & normalization of the raw model output.
   This is the trust layer: it turns whatever the model returned into a normalized,
   human-reviewable suggestion and decides when a human MUST review before submit.
   It deliberately does NOT map sides to players — the app does that (the photo can't
   tell who played, only left vs right). */

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

function normalizeSide(side, label, flags) {
  const s = side || {};
  const goals = toCount(s.goals);
  let shots = toCount(s.shots);
  let sot = toCount(s.shots_on_target);
  const possession = toPct(s.possession);
  const team_name =
    typeof s.team_name === "string" && s.team_name.trim() ? s.team_name.trim() : null;

  if (goals === null) flags.push(`${label}_goals_unreadable`);
  // shots on target cannot exceed total shots
  if (shots !== null && sot !== null && sot > shots) {
    flags.push(`${label}_sot_gt_shots`);
    sot = shots;
  }
  return { team_name, goals, possession, shots, shots_on_target: sot };
}

/**
 * Normalize a raw report_match_stats tool input.
 * @returns {{
 *   ok: boolean, reason?: string, detectedScreen: boolean, confidence: number,
 *   requiresReview: boolean, flags: string[],
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
    suggestion: { home, away, homeResult },
  };
}

export const _internals = { toCount, toPct, CONFIDENCE_FLOOR };
