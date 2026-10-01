/**
 * Invite links: `/join?code=OFC-XXXXX`. An admin shares the link; whoever opens it gets
 * the code prefilled on the join step. A signed-out visitor is bounced to sign-in by the
 * root navigator (which drops the query), so the join screen stashes the code the moment
 * it sees it and reads it back after sign-up → verify → profile.
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Public web build — native has no origin of its own to build links from. */
const WEB_APP_URL = "https://office-fc.web.app";

const STASH_KEY = "officefc.pendingJoinCode";

/** Join codes are uppercase with no whitespace (matches the join field's normaliser). */
export function normalizeJoinCode(raw: string): string {
  return raw.toUpperCase().replace(/\s/g, "");
}

export function inviteLinkFor(code: string): string {
  const origin =
    Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : WEB_APP_URL;
  return `${origin}/join?code=${encodeURIComponent(code)}`;
}

export async function stashJoinCode(code: string): Promise<void> {
  const clean = normalizeJoinCode(code);
  if (!clean) return;
  await AsyncStorage.setItem(STASH_KEY, clean).catch(() => undefined);
}

export async function readStashedJoinCode(): Promise<string | null> {
  return AsyncStorage.getItem(STASH_KEY).catch(() => null);
}

export async function clearStashedJoinCode(): Promise<void> {
  await AsyncStorage.removeItem(STASH_KEY).catch(() => undefined);
}

/**
 * Copy text to the clipboard on web. Returns false when the browser refuses (insecure
 * origin, permissions) so the caller can say so instead of claiming success. Native has
 * no clipboard module installed — callers use the share sheet there.
 */
export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path (e.g. clipboard permission denied in an iframe).
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
