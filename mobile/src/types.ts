/** Shared domain types used across the UI primitives. */

export type MatchResult = "W" | "D" | "L";

/** A league player as the UI primitives consume it. */
export interface Player {
  id: string;
  name: string;
  handle: string;
  jersey: number;
  /** Avatar base colour (hex). */
  color: string;
  /** Two-letter initials (derived from name when absent). */
  initials?: string;
  isYou?: boolean;
}

/** Derive the two-letter initials used by the avatar. */
export function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
