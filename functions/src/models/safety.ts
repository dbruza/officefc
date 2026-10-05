/**
 * Pure safety rules shared by Cloud Functions and the app (App Store guideline 1.2):
 * member status, the display-name filter, report reasons and block lists. No Firestore
 * dependency, so both sides import the same rules and the unit tests exercise them.
 */

/**
 * A member doc without `status` is active. Removed members lose access but keep their
 * history; deleted members are tombstones left by account deletion so opponents' results
 * still resolve to a name.
 */
export type MemberStatus = "active" | "removed" | "deleted";

export function memberStatusOf(data: { status?: unknown } | undefined | null): MemberStatus {
  const status = data?.status;
  return status === "removed" || status === "deleted" ? status : "active";
}

/** Shown wherever an account-deleted player's name used to be. */
export const DELETED_PLAYER_NAME = "Deleted player";
export const DELETED_PLAYER_HANDLE = "deleted";
/** Shown to a viewer in place of a player they've blocked. */
export const BLOCKED_PLAYER_NAME = "Blocked player";

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

// Whole words (after normalising) that are never acceptable on their own.
const BLOCKED_WORDS = new Set([
  "anal",
  "arse",
  "arsehole",
  "ass",
  "asshole",
  "bellend",
  "bollocks",
  "cum",
  "dildo",
  "heil",
  "hitler",
  "jizz",
  "kkk",
  "nazi",
  "paki",
  "piss",
  "porn",
  "prick",
  "pussy",
  "rape",
  "rapist",
  "spic",
  "kike",
  "gook",
  "tranny",
  // Spelled out rather than stemmed: "shit…", "slut…" and "wank…" begin real names
  // (Shital, Slutsky, Wankhede).
  "bullshit",
  "cunt",
  "cunts",
  "shit",
  "shite",
  "shithead",
  "shits",
  "shitty",
  "slut",
  "sluts",
  "slutty",
  "twat",
  "twats",
  "wank",
  "wanker",
  "wankers",
  "wanking",
]);

// Word starts: catches inflections like "fucker" and "bitches".
const BLOCKED_STEMS = ["bastard", "bitch", "fuck", "whore"];

// Slurs blocked even when hidden inside a longer run of letters ("xXslurXx", "s l u r").
// Only long, unambiguous strings belong here — short ones would catch ordinary names.
const BLOCKED_ANYWHERE = ["nigger", "nigga", "faggot", "retard", "wetback"];

const LEET: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
};

function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[013457@$!]/g, (chr) => LEET[chr] ?? chr);
}

/**
 * True when a display name or handle contains offensive language. Deliberately small and
 * conservative: it stops the obvious cases before they're shown to the league, and the
 * report button plus admin review handle the rest.
 */
export function isOffensiveName(text: string): boolean {
  const normalised = normalise(text);
  const words = normalised.split(/[^a-z]+/).filter(Boolean);
  if (words.some((word) => BLOCKED_WORDS.has(word))) return true;
  if (words.some((word) => BLOCKED_STEMS.some((stem) => word.startsWith(stem)))) return true;
  const letters = normalised.replace(/[^a-z]/g, "");
  return BLOCKED_ANYWHERE.some((slur) => letters.includes(slur));
}

/** Why a profile name can't be saved, or null when it's fine. */
export function displayNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < DISPLAY_NAME_MIN) return "Enter at least 2 characters.";
  if (trimmed.length > DISPLAY_NAME_MAX) return `Keep it to ${DISPLAY_NAME_MAX} characters.`;
  if (isOffensiveName(trimmed)) return "Pick a name without offensive language.";
  return null;
}

/** Neutral replacement when an offensive name has to be taken down. */
export function neutralProfileName(jersey: unknown): { displayName: string; handle: string } {
  const number = Number.isInteger(jersey) && Number(jersey) >= 1 && Number(jersey) <= 99;
  const suffix = number ? String(jersey) : "";
  return { displayName: `Player ${suffix}`.trim(), handle: `player${suffix}` };
}

export const REPORT_REASONS = [
  "offensive_name",
  "inappropriate_photo",
  "harassment",
  "cheating",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Readonly<Record<ReportReason, string>> = {
  offensive_name: "Offensive name",
  inappropriate_photo: "Inappropriate photo",
  harassment: "Harassment or abuse",
  cheating: "Fake or cheated results",
  other: "Something else",
};

export const REPORT_DETAILS_MAX = 500;

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value);
}

/** Apply a block/unblock to a stored list, keeping it de-duplicated and bounded. */
export function nextBlockList(current: unknown, targetUid: string, blocked: boolean): string[] {
  const list = Array.isArray(current)
    ? current.filter((id): id is string => typeof id === "string")
    : [];
  const without = list.filter((id) => id !== targetUid);
  return blocked ? [...without, targetUid].slice(-200) : without;
}

export function blockListOf(data: { blocked?: unknown } | undefined | null): string[] {
  return nextBlockList(data?.blocked, "", false);
}
