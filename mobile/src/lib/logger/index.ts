import { Platform } from "react-native";
import Constants from "expo-constants";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import {
  LogBuffer,
  sanitizeContext,
  extractDuration,
  isSlow,
  DEFAULT_SLOW_MS,
  type LogEntry,
  type LogLevel,
} from "./core";

export { STARTUP_SLOW_MS } from "./core";

// React Native / Expo define this global at runtime; declare it for the type checker.
declare const __DEV__: boolean;

const REMOTE_ENABLED = process.env.EXPO_PUBLIC_REMOTE_LOGGING === "1";
const APP_VERSION = Constants.expoConfig?.version ?? "unknown";
const FLUSH_AT = 10; // entries — flush a burst immediately
const FLUSH_DEBOUNCE_MS = 3000; // ...but never let a lone warn/error wait longer than this
const BUFFER_MAX = 50;

const buffer = new LogBuffer(BUFFER_MAX);
let ctxUid: string | null = null;
let ctxRoute: string | null = null;

/** Wired from the auth provider so every entry carries the signed-in uid. */
export function setLogUid(uid: string | null): void {
  ctxUid = uid;
  if (uid) void flush(); // drain anything buffered before sign-in
}

/** Wired from navigation so entries record the active screen. */
export function setLogRoute(route: string | null): void {
  ctxRoute = route;
}

function emit(level: LogLevel, event: string, context?: unknown): void {
  const { durationMs, context: rest } = extractDuration(sanitizeContext(context));
  const entry: LogEntry = {
    level,
    event,
    durationMs,
    context: {
      ...rest,
      // System fields are spread last so caller context can never override them.
      platform: Platform.OS,
      appVersion: APP_VERSION,
      uid: ctxUid,
      route: ctxRoute,
    },
    clientTs: Date.now(),
  };

  if (level === "error") console.error(`[${event}]`, entry.context);
  else if (level === "warn") console.warn(`[${event}]`, entry.context);
  else if (__DEV__) console.log(`[${level}] ${event}`, entry.context);

  if (REMOTE_ENABLED && (level === "warn" || level === "error")) {
    buffer.push(entry);
    if (buffer.size >= FLUSH_AT) void flush();
    else scheduleFlush();
  }
}

export const logger = {
  debug: (event: string, context?: unknown) => emit("debug", event, context),
  info: (event: string, context?: unknown) => emit("info", event, context),
  warn: (event: string, context?: unknown) => emit("warn", event, context),
  error: (event: string, context?: unknown) => emit("error", event, context),
};

let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounce a flush so a single buffered warn/error is forwarded within FLUSH_DEBOUNCE_MS. */
function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DEBOUNCE_MS);
}

/** Best-effort: forward buffered warn/error entries to the authenticated sink. Never throws. */
export async function flush(): Promise<void> {
  if (flushing || !REMOTE_ENABLED || !ctxUid) return; // authenticated-only sink
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = buffer.drain();
  if (batch.length === 0) return;
  flushing = true;
  try {
    await httpsCallable(functions, "ingestLog")({ entries: batch });
  } catch {
    // A logging failure must never affect the app.
  } finally {
    flushing = false;
  }
}

/** Time an async op; logs a `slow_read` warning past the threshold. Never alters the result. */
export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  thresholdMs: number = DEFAULT_SLOW_MS,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const count = Array.isArray(result) ? result.length : undefined;
    if (isSlow(durationMs, thresholdMs)) logger.warn("slow_read", { label, durationMs, count });
    else if (__DEV__) logger.debug("read", { label, durationMs, count });
    return result;
  } catch (error) {
    logger.warn("read_failed", {
      label,
      durationMs: Date.now() - start,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
