/**
 * Stale-while-revalidate data loading for screens.
 *
 * Screens used to refetch everything on every focus with a full-screen spinner,
 * which blanked the page and blocked the JS thread mid-transition. This hook keeps
 * results in a module-level cache keyed by screen: cached data renders immediately
 * on refocus while a background refresh runs after the navigation transition
 * settles (InteractionManager), so animations never compete with Firestore work.
 */
import { useCallback, useRef, useState } from "react";
import { InteractionManager } from "react-native";
import { useFocusEffect } from "expo-router";

const cache = new Map<string, unknown>();

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
  /** Re-run the fetch immediately (retry buttons, post-mutation refresh). */
  reload: () => Promise<void>;
}

export function useFocusData<T>(key: string, fetcher: () => Promise<T>): FocusData<T> {
  const [data, setData] = useState<T | undefined>(() => cache.get(key) as T | undefined);
  const [fetching, setFetching] = useState(false);
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
    if (cached !== undefined) setData(cached);
  }

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    const fetchedKey = keyRef.current;
    setFetching(true);
    setError(false);
    try {
      const value = await fetcherRef.current();
      cache.set(fetchedKey, value);
      if (generation.current === gen) setData(value);
    } catch {
      if (generation.current === gen) setError(true);
    } finally {
      if (generation.current === gen) setFetching(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => void reload());
      return () => task.cancel();
      // `key` retriggers the fetch when the cache key changes while focused.
    }, [reload, key]),
  );

  return {
    data,
    loading: fetching && data === undefined,
    refreshing: fetching && data !== undefined,
    error,
    reload,
  };
}
