/**
 * Per-category push mute preferences, stored at pushPrefs/{uid} with rules allowing
 * each user to read/write only their own doc ({muted, updatedAt}). The functions side
 * (functions/src/notify.ts) checks this doc before delivering and delivers everything
 * when it's missing or malformed — so "nothing muted" needs no doc at all, and these
 * helpers only write when a user actually toggles something.
 *
 * Category keys must stay in sync with PUSH_CATEGORY_KEYS in notify.ts.
 */
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { timed } from "../logger";

export const PUSH_CATEGORIES = [
  { key: "results", label: "Match results", icon: "ball" },
  { key: "confirmations", label: "Confirmations", icon: "check" },
  { key: "disputes", label: "Disputes", icon: "swords" },
  { key: "fixtures", label: "Fixtures", icon: "calendar" },
  { key: "finals", label: "Finals", icon: "trophy" },
  { key: "general", label: "General activity", icon: "bolt" },
] as const;

export type PushCategoryKey = (typeof PUSH_CATEGORIES)[number]["key"];

/** Load the signed-in user's muted categories; no doc means nothing is muted. */
export async function loadPushPrefs(uid: string): Promise<PushCategoryKey[]> {
  return timed("loadPushPrefs", async () => {
    const snap = await getDoc(doc(db, "pushPrefs", uid));
    if (!snap.exists()) return [];
    return parseMuted(snap.get("muted"));
  });
}

/**
 * Toggle one category on or off, writing the full muted list plus updatedAt (the
 * exact field set the security rules allow). Returns the new list so callers can
 * keep optimistic state honest.
 */
export async function toggleCategory(
  uid: string,
  category: PushCategoryKey,
  muted: boolean,
): Promise<PushCategoryKey[]> {
  return timed("togglePushCategory", async () => {
    const snap = await getDoc(doc(db, "pushPrefs", uid));
    const current = snap.exists() ? parseMuted(snap.get("muted")) : [];
    // Rebuild from current server state so two rapid toggles can't resurrect a
    // category one of them just unmuted.
    const next = muted
      ? current.includes(category)
        ? current
        : [...current, category]
      : current.filter((entry) => entry !== category);
    await setDoc(doc(db, "pushPrefs", uid), {
      muted: next,
      updatedAt: serverTimestamp(),
    });
    return next;
  });
}

/** Defensive parse mirroring isMuted on the functions side: junk shapes read as empty. */
function parseMuted(value: unknown): PushCategoryKey[] {
  if (!Array.isArray(value)) return [];
  const known = PUSH_CATEGORIES.map((category) => category.key);
  return value.filter(
    (entry): entry is PushCategoryKey =>
      typeof entry === "string" && (known as readonly string[]).includes(entry),
  );
}
