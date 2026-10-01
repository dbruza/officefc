/**
 * Web-only affordances: CSS-only style props, per-screen document titles, and keyboard
 * shortcuts. Everything here is a no-op on native so callers don't need Platform guards.
 */
import { useCallback, useEffect, useRef } from "react";
import { Platform, type ViewStyle } from "react-native";
import { useFocusEffect } from "expo-router";

const IS_WEB = Platform.OS === "web";

/**
 * Style props react-native-web understands but RN's types don't (cursor, transitions,
 * box-shadow strings, outlines, user-select). Returns `{}` on native.
 */
export interface WebStyle {
  cursor?: "pointer" | "default" | "text" | "grab" | "not-allowed" | "zoom-in" | "zoom-out";
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTimingFunction?: string;
  boxShadow?: string;
  userSelect?: "none" | "auto" | "text";
  outlineStyle?: "none" | "solid";
  outlineWidth?: number;
  outlineColor?: string;
  outlineOffset?: number;
  backdropFilter?: string;
  willChange?: string;
  position?: "sticky" | "fixed";
  top?: number;
  overflowX?: "auto" | "hidden";
  scrollbarWidth?: "none" | "thin";
}

export function webStyle(style: WebStyle): ViewStyle {
  return IS_WEB ? (style as unknown as ViewStyle) : {};
}

/** Standard hover/press transition for interactive surfaces. */
export const webTransition = webStyle({
  transitionProperty: "background-color, border-color, transform, box-shadow, opacity, color",
  transitionDuration: "160ms",
  transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
});

let screenTitle: string | null = null;
let titleBadge = 0;

function applyTitle() {
  if (!IS_WEB || typeof document === "undefined") return;
  const base = screenTitle ? `${screenTitle} · OfficeFC` : "OfficeFC";
  document.title = titleBadge > 0 ? `(${titleBadge}) ${base}` : base;
}

/**
 * Set the browser tab title while this screen is focused (stack screens stay mounted
 * underneath, so a plain mount effect would leave a stale title after going back).
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useFocusEffect(
    useCallback(() => {
      screenTitle = title ?? null;
      applyTitle();
    }, [title]),
  );
}

/** Prefix the tab title with a count — "(2) Home · OfficeFC" — for results awaiting you. */
export function setTitleBadge(count: number): void {
  if (count === titleBadge) return;
  titleBadge = count;
  applyTitle();
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

/**
 * Single-key keyboard shortcut (web only). Ignored while typing in a field or when a
 * modifier is held, so it never fights browser or form shortcuts.
 */
export function useHotkey(key: string, handler: () => void, enabled = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!IS_WEB || !enabled || typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() !== key.toLowerCase()) return;
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, enabled]);
}
