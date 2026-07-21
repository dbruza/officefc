import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { loggedOnCall } from "./logging";
import { sanitizeLogBatch, type Severity } from "./clientLogs/sanitize";
import { checkRateLimit } from "./clientLogs/rateLimit";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60; // accepted batches per uid per minute (per instance — best effort)
const RATE_MAX_UIDS = 10_000; // bound memory: drop the table if it grows unbounded (best effort)
const hits = new Map<string, number[]>();

const EMIT: Record<Severity, (msg: string, data: unknown) => void> = {
  debug: (m, d) => logger.debug(m, d),
  info: (m, d) => logger.info(m, d),
  warn: (m, d) => logger.warn(m, d),
  error: (m, d) => logger.error(m, d),
};

/** Authenticated-only client→Cloud Logging sink. Treats all payload fields as untrusted. */
export const ingestLog = loggedOnCall("ingestLog", { cors: true }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = req.auth.uid; // the ONLY authoritative uid
  const now = Date.now();

  const decision = checkRateLimit(hits.get(uid) ?? [], now, RATE_WINDOW_MS, RATE_MAX);
  if (!decision.allowed) {
    logger.warn("client_log_ratelimited", { uid });
    return { accepted: 0, rejected: 0, rateLimited: true };
  }
  if (hits.size > RATE_MAX_UIDS) hits.clear();
  hits.set(uid, decision.next);

  const { accepted, rejected } = sanitizeLogBatch(req.data, { now });
  for (const entry of accepted) {
    EMIT[entry.level]("client_event", {
      source: "client",
      uid,
      event: entry.event,
      durationMs: entry.durationMs,
      clientTs: entry.clientTs,
      context: entry.context,
    });
  }
  return { accepted: accepted.length, rejected };
});
