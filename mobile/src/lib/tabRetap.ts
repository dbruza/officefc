/**
 * Re-tapping the already-active bottom tab scrolls that tab to the top.
 * Tiny in-process emitter: the tab bar emits, tab screens subscribe.
 */
import { useEffect, useRef } from "react";

type TabRetapListener = (tab: string) => void;

const listeners = new Set<TabRetapListener>();

export function emitTabRetap(tab: string): void {
  listeners.forEach((listener) => listener(tab));
}

/** Run `handler` whenever the given tab is re-tapped while already active. */
export function useTabRetap(tab: string, handler: () => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const listener: TabRetapListener = (retapped) => {
      if (retapped === tab) handlerRef.current();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [tab]);
}
