// ESM (.mjs) on purpose: imported directly by the root `node --test` suite and compiled by functions tsc. Do not rename to .js.
/* OfficeFC — prompt construction for LLM match analysis.
   Every number quoted to the model comes from the committed match doc, so the prose can
   never contradict the rating math. The model's job is narrative insight, not arithmetic. */

const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * Assemble the user-facing match context block from the analysis payload the callable
 * gathers. All fields optional-safe: absent stats render as "not recorded".
 *
 * @param {object} ctx  see gatherAnalysisContext in analyzeMatch.ts
 * @returns string — the user prompt
 */
export function buildUserPrompt(ctx) {
  const lines = [];
  lines.push(`MATCH RESULT`);
  lines.push(
    `${ctx.playerA.name} (${ctx.match.aTeam}) ${ctx.match.aGoals}–${ctx.match.bGoals} ${ctx.playerB.name} (${ctx.match.bTeam})`,
  );
  if (ctx.seasonName) lines.push(`Competition: ${ctx.seasonName}`);
  if (ctx.match.date) lines.push(`Date: ${ctx.match.date}`);
  if (ctx.isFinals) lines.push(`This was a FINALS knockout tie.`);

  const hasElo = ctx.match.aEloBefore != null && ctx.match.bEloBefore != null;
  if (hasElo) {
    lines.push("");
    lines.push("RATINGS");
    lines.push(
      `${ctx.playerA.name}: ${ctx.match.aEloBefore} -> ${
        ctx.match.aEloAfter ?? "?"
      } (delta ${signed(ctx.match.aDelta ?? 0)})`,
    );
    lines.push(
      `${ctx.playerB.name}: ${ctx.match.bEloBefore} -> ${
        ctx.match.bEloAfter ?? "?"
      } (delta ${signed(ctx.match.bDelta ?? 0)})`,
    );
    const ex = ctx.eloExplain;
    if (ex) {
      lines.push(
        `Pre-match win probability from the ELO model: ${ctx.playerA.name} ${pct(ex.aExpected)}, ${ctx.playerB.name} ${pct(ex.bExpected)}`,
      );
      const overallA = ex.aTeamAdj !== 0 ? Math.round(ex.aTeamAdj / 12) : null; // TEAM_ELO_PER_OVERALL = 12
      if (overallA != null && overallA !== 0) {
        lines.push(
          `Team-strength handicap: ${ctx.playerA.name}'s team was ${Math.abs(overallA)} FIFA overall point(s) ${overallA > 0 ? "stronger" : "weaker"}.`,
        );
      }
      if ((ex.aK ?? 32) > 32 || (ex.bK ?? 32) > 32) {
        lines.push(
          `At least one player is still on the provisional K-factor (first 10 games of a season, bigger swings).`,
        );
      }
    }
  }

  const a = ctx.match.aStats ?? {};
  const b = ctx.match.bStats ?? {};
  const statLines = [];
  if (a.possession != null) statLines.push(`Possession: ${a.possession}%–${b.possession ?? "?"}%`);
  if (a.shots != null) statLines.push(`Shots: ${a.shots}–${b.shots ?? "?"}`);
  if (a.shotsOnTarget != null)
    statLines.push(`Shots on target: ${a.shotsOnTarget}–${b.shotsOnTarget ?? "?"}`);
  if (a.xg != null)
    statLines.push(`Expected goals (xG): ${fmtXg(a.xg)}–${b.xg != null ? fmtXg(b.xg) : "?"}`);
  if (statLines.length > 0) {
    lines.push("");
    lines.push("MATCH STATS");
    statLines.forEach((line) => lines.push(line));
  }

  const s = ctx.seasonForm?.[ctx.playerA.id];
  const t = ctx.seasonForm?.[ctx.playerB.id];
  if (s || t) {
    lines.push("");
    lines.push("CURRENT SEASON CONTEXT");
    if (s)
      lines.push(
        `${ctx.playerA.name}: rank #${s.rank}, ${s.w}W-${s.d}D-${s.l}L this season${s.streakText ? `, ${s.streakText}` : ""}`,
      );
    if (t)
      lines.push(
        `${ctx.playerB.name}: rank #${t.rank}, ${t.w}W-${t.d}D-${t.l}L this season${t.streakText ? `, ${t.streakText}` : ""}`,
      );
  }

  const h2h = ctx.headToHead;
  if (h2h && h2h.games > 1) {
    lines.push("");
    lines.push("CURRENT HEAD-TO-HEAD (includes this result for league matches)");
    lines.push(
      `${h2h.games} recorded meetings: ${ctx.h2hNames.a} ${h2h.aWins} wins, ${ctx.h2hNames.b} ${h2h.bWins} wins, ${h2h.draws} draws. Aggregate goals ${h2h.aGoals}-${h2h.bGoals}.`,
    );
    if (h2h.recent && h2h.recent.length > 0) {
      h2h.recent.forEach((m) => {
        lines.push(
          `- ${m.dateLabel ?? "earlier"}: ${ctx.h2hNames.a} vs ${ctx.h2hNames.b} ${m.score}`,
        );
      });
    }
  }

  if (ctx.mvpName) {
    lines.push("");
    lines.push(`Man of the match by teammate vote: ${ctx.mvpName}`);
  }

  return lines.join("\n");
}

export function fmtXg(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

export const SYSTEM_PROMPT = `You are the resident pundit for OfficeFC, an office league on EA Sports FC where colleagues play head-to-head matches rated by an ELO system.

You will be given one confirmed result with its committed numbers: pre/post ratings and deltas, the ELO model's pre-match win probabilities, extracted match statistics when available (possession, shots, shots on target, xG), both players' season records, and their current head-to-head history. Season records and head-to-head totals are current when this analysis is generated, not necessarily the records before the selected match. Do not describe them as pre-match records.

Write for the two players and their colleagues reading the app. Be sharp, specific and fun — like a good football columnist in miniature — but stay grounded in the supplied numbers. NEVER invent statistics that are not in the data; if stats were not recorded, analyse the scoreline and the rating swing instead of guessing at how the game looked. Do not do novel arithmetic beyond simple comparisons already implied by the data (e.g. "outperformed their xG", "more possession but fewer shots on target").

Reply with ONLY a JSON object (no markdown fences, no commentary) shaped exactly:
{
  "headline": string,           // max 60 chars, punchy tabloid-style summary
  "summary": string,            // 2-4 sentences on how the game unfolded per the numbers
  "surpriseLevel": "expected" | "mild_upset" | "shock",
  "surpriseNote": string,       // 1 sentence explaining that verdict against the pre-match probabilities
  "ratingStory": string,        // 1-2 sentences: what the ELO swing means for each player
  "talkingPoints": string[3],   // exactly 3 short bullets, each grounded in the given data
}`;

/** Extract and validate the JSON object the model was asked to return. Throws on unusable output. */
export function parseAnalysis(content) {
  if (typeof content !== "string") throw new Error("parseAnalysis: content must be a string");
  // Tolerate fenced or annotated JSON: grab the outermost object.
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("parseAnalysis: no JSON object found");
  let parsed;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch (error) {
    throw new Error(`parseAnalysis: invalid JSON (${error.message})`);
  }
  const o = parsed && typeof parsed === "object" ? parsed : {};

  const headline = typeof o.headline === "string" ? o.headline.trim().slice(0, 80) : "";
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  const surpriseLevel =
    o.surpriseLevel === "shock" || o.surpriseLevel === "mild_upset" ? o.surpriseLevel : "expected";
  const surpriseNote = typeof o.surpriseNote === "string" ? o.surpriseNote.trim() : "";
  const ratingStory = typeof o.ratingStory === "string" ? o.ratingStory.trim() : "";
  const talkingPoints = Array.isArray(o.talkingPoints)
    ? o.talkingPoints
        .filter((p) => typeof p === "string")
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  if (!headline || !summary) throw new Error("parseAnalysis: missing headline or summary");
  return {
    headline,
    summary,
    surpriseLevel,
    surpriseNote,
    ratingStory,
    talkingPoints,
  };
}
