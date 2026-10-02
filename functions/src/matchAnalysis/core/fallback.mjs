// ESM (.mjs) on purpose: imported directly by the root `node --test` suite and compiled by functions tsc. Do not rename to .js.
/* OfficeFC — deterministic fallback analysis for when every LLM in the chain fails
   (free models rotate and rate-limit). The match screen must always have an analysis
   card, so this derives one from the same committed numbers the prompt would have used.
   Same output shape as parseAnalysis, flagged model: "fallback" so the UI can label it. */

const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));

function fmtXg(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

/** Classify surprise purely from the pre-match win probability of the eventual winner. */
export function classifySurprise(aGoals, bGoals, aExpected) {
  const drew = aGoals === bGoals;
  const aWon = aGoals > bGoals;
  // Winner's pre-match expectation; for a draw use the closer-to-50% side's view.
  const wExp = drew ? Math.max(aExpected, 1 - aExpected) : aWon ? aExpected : 1 - aExpected;
  if (drew) {
    if (wExp >= 0.65) return "mild_upset"; // heavy favourite only drew
    return "expected";
  }
  if (wExp < 0.35) return "shock";
  if (wExp < 0.5) return "mild_upset";
  return "expected";
}

/**
 * Build the fallback analysis object from gathered context.
 * @param {object} ctx same shape buildUserPrompt consumes
 */
export function fallbackAnalysis(ctx) {
  const { match, playerA, playerB } = ctx;
  const nameA = playerA.name;
  const nameB = playerB.name;
  const scoreline = `${match.aGoals}–${match.bGoals}`;
  const aWon = match.aGoals > match.bGoals;
  const drew = match.aGoals === match.bGoals;
  const winnerName = aWon ? nameA : nameB;
  const loserName = aWon ? nameB : nameA;

  const ex = ctx.eloExplain;
  const aExpected = ex ? ex.aExpected : 0.5;
  const level = classifySurprise(match.aGoals, match.bGoals, aExpected);

  let headline;
  if (drew) headline = `${nameA} and ${nameB} share the points at ${scoreline}`;
  else if (level === "shock") headline = `Shock! ${winnerName} stun ${loserName} ${scoreline}`;
  else if (level === "mild_upset") headline = `${winnerName} edge past ${loserName} ${scoreline}`;
  else headline = `${winnerName} take care of business against ${loserName}, ${scoreline}`;

  const summaryBits = [];
  if (ex && !drew) {
    const wExp = aWon ? ex.aExpected : ex.bExpected;
    summaryBits.push(
      wExp < 0.45
        ? `${winnerName} came into this one as a ${pct(wExp)} underdog and took the win anyway.`
        : `The ratings made ${winnerName} a ${pct(wExp)} favourite, and the result followed.`,
    );
  } else if (drew) {
    summaryBits.push(`Honours even at ${scoreline}.`);
  }
  const a = match.aStats ?? {};
  const b = match.bStats ?? {};
  if (a.xg != null || a.possession != null) {
    const bits = [];
    if (a.xg != null) bits.push(`${fmtXg(a.xg)}–${b.xg != null ? fmtXg(b.xg) : "?"} xG`);
    if (a.possession != null) bits.push(`${a.possession}% possession for ${nameA}`);
    summaryBits.push(`Recorded stats: ${bits.join(", ")}.`);
  } else {
    summaryBits.push("No detailed stats were recorded for this result.");
  }

  let surpriseNote;
  if (!ex) {
    surpriseNote = "Pre-match probabilities were not recorded for this match.";
  } else if (level === "shock") {
    surpriseNote = `The model gave ${winnerName} only ${pct(aWon ? ex.aExpected : ex.bExpected)} before kick-off.`;
  } else if (level === "mild_upset") {
    surpriseNote = `${winnerName} were slightly against the odds at ${pct(aWon ? ex.aExpected : ex.bExpected)}.`;
  } else {
    surpriseNote = `Went the way the ratings expected (${pct(Math.max(ex.aExpected, ex.bExpected))} favourite).`;
  }

  const hasDeltas =
    match.aDelta != null && match.bDelta != null && (match.aDelta !== 0 || match.bDelta !== 0);
  const ratingStory = !hasDeltas
    ? "Ratings are unchanged or still pending confirmation."
    : `${winnerName} ${signed(drew ? Math.max(match.aDelta, match.bDelta) : aWon ? match.aDelta : match.bDelta)}, ${drew ? "evenly split" : loserName + " " + signed(aWon ? match.bDelta : match.aDelta)}.`;

  const talkingPoints = [];
  if (a.shots != null && b.shots != null && a.shots !== b.shots) {
    const moreShotsIsA = a.shots > b.shots;
    talkingPoints.push(
      `Shot battle went ${moreShotsIsA ? nameA : nameB}'s way, ${Math.max(a.shots, b.shots)}–${Math.min(a.shots, b.shots)}.`,
    );
  }
  if (
    a.possession != null &&
    Math.abs(a.possession - 50) >= 10 &&
    ((a.possession > 50 && !aWon && !drew) || (a.possession < 50 && aWon))
  ) {
    talkingPoints.push(`${nameA} had the ball but ${nameB} had the result.`);
  }
  if (ctx.headToHead && ctx.headToHead.games > 2) {
    talkingPoints.push(
      `Season-long rivalry: now ${ctx.h2hNames.a} ${ctx.headToHead.aWins}–${ctx.headToHead.bWins} ${ctx.h2hNames.b} across ${ctx.headToHead.games + 1} meetings.`,
    );
  }
  if (talkingPoints.length === 0) {
    talkingPoints.push(
      drew
        ? `Both players leave with a point — no damage done to either rating.`
        : `Three points banked; the table never lies for long.`,
    );
  }
  while (talkingPoints.length < 3) {
    talkingPoints.push(
      [
        `${nameA} move on to their next fixture looking to build momentum.`,
        `${nameB} will want another crack at this fixture soon.`,
        `Every confirmed match keeps the season race alive.`,
      ][talkingPoints.length] ?? `The league rolls on.`,
    );
  }

  return {
    headline: headline.slice(0, 80),
    summary: summaryBits.join(" ").slice(0, 600),
    surpriseLevel: level,
    surpriseNote,
    ratingStory,
    talkingPoints: talkingPoints.slice(0, 3),
  };
}
