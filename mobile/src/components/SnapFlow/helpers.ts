import { colors } from "@/theme";

// Maps the review flags returned by the AI extraction backend to human-readable copy.
export function flagLabel(field: string): string {
  const map: Record<string, string> = {
    low_confidence: "AI confidence is low — please double-check these values",
    home_goals_unreadable: "Home goals could not be read",
    away_goals_unreadable: "Away goals could not be read",
    possession_sum_off: "Possession doesn't add up to ~100%",
    home_sot_gt_shots: "Home shots on target > total shots (clamped)",
    away_sot_gt_shots: "Away shots on target > total shots (clamped)",
    home_xg_implausible: "Home xG looked implausible and was clamped",
    away_xg_implausible: "Away xG looked implausible and was clamped",
  };
  return map[field] || field;
}

/** Accent a value the player changed from what the AI read, so edits stand out. */
export function statColor(value: unknown, extractedValue: unknown): string {
  if (extractedValue != null && value !== extractedValue) return colors.accent;
  return colors.text;
}

/** Parse a numeric stat field: empty → null, otherwise the number (keeping a real 0); NaN → null. */
export function parseStatInput(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Pause between processing stages so the checklist visibly completes. */
export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
