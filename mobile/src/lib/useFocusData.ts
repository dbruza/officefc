/**
 * Stale-while-revalidate data loading for screens.
 *
 * Screens used to refetch everything on every focus with a full-screen spinner,
 * which blanked the page and blocked the JS thread mid-transition. This hook keeps
 * results in a module-level cache keyed by screen: cached data renders immediately
 * on refocus while a background refresh runs after the navigation transition
 * settles (InteractionManager), so animations never compete with Firestore work.
 *
 * Office browsers keep a tab open all day, so a focused screen also refetches when the
 * app/tab comes back to the foreground (AppState → visibilitychange on web), at most
 * once per REVISIT_STALE_MS.
 */
import { useCallback, useRef, useState } from "react";
import { AppState, InteractionManager } from "react-native";
import { useFocusEffect } from "expo-router";

const cache = new Map<string, unknown>();

/** Minimum age before returning to the app/tab triggers a background refresh. */
const REVISIT_STALE_MS = 30_000;

/** Drop all cached screen data (call on sign-out so no user sees another's league). */
export function clearFocusDataCache() {
  cache.clear();
}

export interface FocusData<T> {
  /** Cached or freshly fetched value; undefined only before the first-ever load. */
  data: T | undefined;
  /** First-ever load in flight (nothing to show yet) — render the spinner. */
  loading: boolean;
  /** Background refresh in flight while cached data is on screen. */
  refreshing: boolean;
  /** Last fetch failed. Existing data stays visible. */
  error: boolean;
  /**
   * The visible data belongs to a previous key (e.g. the last season) while the new
   * key's first fetch runs — dim it so nobody reads the old table as the new one.
   */
  stale: boolean;
  /** Re-run the fetch immediately (retry buttons, post-mutation refresh). */
  reload: () => Promise<void>;
}

export function useFocusData<T>(key: string, fetcher: () => Promise<T>): FocusData<T> {
  const [data, setData] = useState<T | undefined>(() => cache.get(key) as T | undefined);
  const [dataKey, setDataKey] = useState(key);
  const [fetching, setFetching] = useState(false);
  const lastFetchedAt = useRef(0);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);

  // Key changed (e.g. a different season selected): swap to that key's cached value
  // if present; otherwise keep the previous data visible while the refresh runs.
  if (keyRef.current !== key) {
    keyRef.current = key;
    const cached = cache.get(key) as T | undefined;
    if (cached !== undefined) {
      setData(cached);
      setDataKey(key);
    }
  }

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    const fetchedKey = keyRef.current;
    setFetching(true);
    setError(false);
    try {
      const value = await fetcherRef.current();
      cache.set(fetchedKey, value);
      lastFetchedAt.current = Date.now();
      if (generation.current === gen) {
        setData(value);
        setDataKey(fetchedKey);
      }
    } catch {
      if (generation.current === gen) setError(true);
    } finally {
      if (generation.current === gen) setFetching(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => void reload());
      // Returning to the app/tab while this screen is focused: refresh if it's been a while.
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active" && Date.now() - lastFetchedAt.current > REVISIT_STALE_MS) {
          void reload();
        }
      });
      return () => {
        task.cancel();
        sub.remove();
      };
      // `key` retriggers the fetch when the cache key changes while focused.
    }, [reload, key]),
  );

  return {
    data,
    // True from the very first render (the fetch is only scheduled after interactions
    // settle), so screens never flash their empty / not-found state before loading.
    loading: data === undefined && (fetching || !error),
    refreshing: fetching && data !== undefined,
    error,
    stale: data !== undefined && dataKey !== key,
    reload,
  };
}
