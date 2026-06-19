export type LogLevel = "debug" | "info" | "warn" | "error";
export type ScalarOrNull = string | number | boolean | null;

export interface LogEntry {
  level: LogLevel;
  event: string;
  context: Record<string, ScalarOrNull>;
  durationMs?: number;
  clientTs: number;
}

export const DEFAULT_SLOW_MS = 1500;

/** Startup is naturally slower than a single read (cold start + auth restore + reads). */
export const STARTUP_SLOW_MS = 4000;

const REDACT_KEY = /token|secret|password|auth|email|credential|cookie|key/i;
const MAX_CONTEXT_KEYS = 20;
const MAX_STRING_LEN = 500;

/** Pure: reduce arbitrary context to bounded, safe scalars. */
export function sanitizeContext(input: unknown): Record<string, ScalarOrNull> {
  const out: Record<string, ScalarOrNull> = {};
  if (!input || typeof input !== "object") return out;
  let keys = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined) continue; // omit absent fields rather than tag them "[unsupported]"
    if (keys >= MAX_CONTEXT_KEYS) break;
    keys++;
    out[key] = REDACT_KEY.test(key) ? "[redacted]" : toScalar(value);
  }
  return out;
}

function toScalar(value: unknown): ScalarOrNull {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) + "…" : value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    default:
      return "[unsupported]";
  }
}

/** Fixed-size FIFO buffer; drops the oldest entry on overflow. */
export class LogBuffer {
  private items: LogEntry[] = [];
  constructor(private readonly max: number) {}
  push(entry: LogEntry): void {
    this.items.push(entry);
    if (this.items.length > this.max) this.items.shift();
  }
  get size(): number {
    return this.items.length;
  }
  drain(): LogEntry[] {
    const out = this.items;
    this.items = [];
    return out;
  }
}

/** Pure: should a completed op be flagged slow? */
export function isSlow(durationMs: number, thresholdMs: number = DEFAULT_SLOW_MS): boolean {
  return durationMs >= thresholdMs;
}

/**
 * Pull a numeric `durationMs` out of a sanitized context so it can become a top-level field
 * on the entry (rather than living buried in freeform context). Leaves context untouched
 * when no numeric duration is present.
 */
export function extractDuration(context: Record<string, ScalarOrNull>): {
  durationMs?: number;
  context: Record<string, ScalarOrNull>;
} {
  if (typeof context.durationMs !== "number") return { context };
  const { durationMs, ...rest } = context;
  return { durationMs, context: rest };
}
