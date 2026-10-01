/**
 * "What's new" read state: the newest changelog version this device has opened, kept in
 * AsyncStorage (localStorage on web). Versions newer than it get a NEW badge; opening
 * the changelog marks everything read.
 */
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHANGELOG } from "./changelog";

const KEY = "officefc.changelogLastSeen";

/** Compare dotted versions numerically ("1.10.0.0" > "1.9.0.0"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Whether `version` is unread. With no record yet (first visit) only the latest release
 * counts as new, so a fresh install isn't greeted by a wall of NEW badges.
 */
export function isUnseen(version: string, lastSeen: string | null): boolean {
  if (lastSeen === null) return version === CHANGELOG[0]?.version;
  return compareVersions(version, lastSeen) > 0;
}

export function latestVersion(): string | null {
  return CHANGELOG[0]?.version ?? null;
}

/**
 * The stored last-seen version, re-read whenever the screen regains focus (Settings
 * stays mounted under the changelog, so its badge must clear on the way back). `loaded`
 * is false until storage first answers, so callers don't flash badges prematurely.
 */
export function useChangelogLastSeen(): { lastSeen: string | null; loaded: boolean } {
  const [state, setState] = useState<{ lastSeen: string | null; loaded: boolean }>({
    lastSeen: null,
    loaded: false,
  });
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      AsyncStorage.getItem(KEY)
        .catch(() => null)
        .then((value) => {
          if (!cancelled) setState({ lastSeen: value, loaded: true });
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );
  return state;
}

export async function markChangelogSeen(): Promise<void> {
  const latest = latestVersion();
  if (latest) await AsyncStorage.setItem(KEY, latest).catch(() => undefined);
}
