export type Severity = "debug" | "info" | "warn" | "error";
const SEVERITIES: Severity[] = ["debug", "info", "warn", "error"];

export interface CleanEntry {
  level: Severity;
  event: string;
  context: Record<string, string | number | boolean | null>;
  durationMs: number | null;
  clientTs: number | null;
}

export interface SanitizeOptions {
  now: number;
  maxBatch?: number;
  maxBytes?: number;
  maxSkewMs?: number;
}

export interface SanitizeResult {
  accepted: CleanEntry[];
  rejected: number;
  reason?: string;
}

const MAX_BATCH = 20;
const MAX_BYTES = 8 * 1024;
const MAX_SKEW = 24 * 60 * 60 * 1000;
const MAX_EVENT = 80;
const MAX_KEYS = 20;
const MAX_STR = 500;
const REDACT = /token|secret|password|auth|email|credential|cookie|key/i;
// Values that look like credentials regardless of their key name (JWT, Bearer/Basic
// headers, Google API keys, OAuth access tokens, sk-/secret-style keys).
const REDACT_VALUE =
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{8,}|AIza[0-9A-Za-z_-]{16,}|ya29\.[0-9A-Za-z_-]+|sk-[A-Za-z0-9]{16,}/i;

export function sanitizeLogBatch(input: unknown, opts: SanitizeOptions): SanitizeResult {
  const maxBatch = opts.maxBatch ?? MAX_BATCH;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const maxSkew = opts.maxSkewMs ?? MAX_SKEW;
  const raw = (input as { entries?: unknown })?.entries;
  if (!Array.isArray(raw)) return { accepted: [], rejected: 0, reason: "no-entries" };

  let rejected = Math.max(0, raw.length - maxBatch);
  const accepted: CleanEntry[] = [];
  for (const item of raw.slice(0, maxBatch)) {
    const clean = cleanEntry(item, opts.now, maxSkew);
    if (!clean || Buffer.byteLength(JSON.stringify(clean), "utf8") > maxBytes) {
      rejected++;
      continue;
    }
    accepted.push(clean);
  }
  return { accepted, rejected };
}

function cleanEntry(raw: unknown, now: number, maxSkew: number): CleanEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const event = typeof r.event === "string" && r.event ? r.event.slice(0, MAX_EVENT) : null;
  if (!event) return null;
  const level = SEVERITIES.includes(r.level as Severity) ? (r.level as Severity) : "info";
  const durationMs =
    typeof r.durationMs === "number" && Number.isFinite(r.durationMs) ? r.durationMs : null;
  let clientTs = typeof r.clientTs === "number" && Number.isFinite(r.clientTs) ? r.clientTs : null;
  if (clientTs !== null && Math.abs(now - clientTs) > maxSkew) clientTs = null;
  return { level, event, context: cleanContext(r.context), durationMs, clientTs };
}

function cleanContext(input: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!input || typeof input !== "object") return out;
  let keys = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (keys >= MAX_KEYS) break;
    keys++;
    out[k] = REDACT.test(k) ? "[redacted]" : scalar(v);
  }
  return out;
}

function scalar(v: unknown): string | number | boolean | null {
  if (v === null) return null;
  if (typeof v === "string") {
    if (REDACT_VALUE.test(v)) return "[redacted]";
    return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  return "[unsupported]";
}
