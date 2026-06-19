/**
 * Pure audit helper for AI-assisted submissions: compare the model's suggestion against what the
 * human actually submitted. No Firestore dependency, so this is unit-testable in isolation.
 */

type Side = "home" | "away";

/**
 * Which extracted fields the human changed before submitting. The extraction is in image space
 * (`home` = left scoreboard column, `away` = right), while the submitted values are framed as
 * `my*`/`opponent*`. `mySide` says which image side the submitter is, so each submitted value is
 * compared against the matching image side. Returned labels stay in image space (`home_*`/`away_*`).
 */
export function fieldsEdited(
  raw: Record<string, unknown> | null | undefined,
  submitted: Record<string, unknown>,
  mySide: Side,
): string[] {
  const edited: string[] = [];
  if (!raw) return edited;
  const home = (raw.home ?? {}) as Record<string, unknown>;
  const away = (raw.away ?? {}) as Record<string, unknown>;
  const myKey: Side = mySide === "home" ? "home" : "away";
  const oppKey: Side = mySide === "home" ? "away" : "home";

  function check(field: string, rawHome: unknown, rawAway: unknown): void {
    const rawBySide: Record<Side, unknown> = { home: rawHome, away: rawAway };
    const subMy = submitted[`my${field}`];
    const subOpp = submitted[`opponent${field}`];
    if (rawBySide[myKey] !== null && rawBySide[myKey] !== undefined && rawBySide[myKey] !== subMy)
      edited.push(`${myKey}_${field.toLowerCase()}`);
    if (
      rawBySide[oppKey] !== null &&
      rawBySide[oppKey] !== undefined &&
      rawBySide[oppKey] !== subOpp
    )
      edited.push(`${oppKey}_${field.toLowerCase()}`);
  }

  check("Goals", home.goals, away.goals);
  check("Possession", home.possession, away.possession);
  check("Shots", home.shots, away.shots);
  check("ShotsOnTarget", home.shots_on_target, away.shots_on_target);
  return edited;
}
