import {
  onCall,
  HttpsError,
  type CallableRequest,
  type CallableOptions,
} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { captureServerFault } from "./sentry";

/** Functions error codes we treat as *expected* client-facing rejections, not server faults. */
const EXPECTED_CODES = new Set([
  "invalid-argument",
  "failed-precondition",
  "out-of-range",
  "not-found",
  "already-exists",
  "permission-denied",
  "unauthenticated",
]);

export type CallableOutcome = { outcome: "rejected"; code: string } | { outcome: "error" };

/** Pure: decide how a thrown value should be logged. */
export function classifyCallableError(error: unknown): CallableOutcome {
  if (error instanceof HttpsError && EXPECTED_CODES.has(error.code)) {
    return { outcome: "rejected", code: error.code };
  }
  return { outcome: "error" };
}

type LoggerLike = {
  debug: (...a: unknown[]) => void;
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
};

interface InstrumentDeps {
  log?: LoggerLike;
  now?: () => number;
  capture?: typeof captureServerFault;
}

/**
 * Wrap a callable handler with ONE structured completion log + error classification.
 * Entry logging is debug-only (the runtime already emits request logs with trace IDs).
 */
export function instrumentCallable<R>(
  name: string,
  handler: (req: CallableRequest) => R | Promise<R>,
  deps: InstrumentDeps = {},
): (req: CallableRequest) => Promise<R> {
  const log = deps.log ?? logger;
  const now = deps.now ?? Date.now;
  const capture = deps.capture ?? captureServerFault;
  return async (req: CallableRequest): Promise<R> => {
    const start = now();
    const uid = req.auth?.uid ?? null;
    log.debug("callable_start", { fn: name, uid });
    try {
      const result = await handler(req);
      log.info("callable_done", { fn: name, uid, durationMs: now() - start, outcome: "ok" });
      return result;
    } catch (error) {
      const durationMs = now() - start;
      const classified = classifyCallableError(error);
      if (classified.outcome === "rejected") {
        log.warn("callable_done", {
          fn: name,
          uid,
          durationMs,
          outcome: "rejected",
          code: classified.code,
        });
      } else {
        // Pass the real Error first so Cloud Logging keeps the original stack.
        log.error(error instanceof Error ? error : new Error(String(error)), {
          event: "callable_failed",
          fn: name,
          uid,
          durationMs,
        });
        // Server faults only (expected rejections stay out of Sentry); awaited because a
        // background send can be lost when the instance freezes after the response. Guarded
        // (incl. sync throws) so a faulty capture impl can never replace the original error.
        try {
          await capture(error, { fn: name, uid, durationMs });
        } catch {
          // Reporting must never mask the original failure.
        }
      }
      throw error;
    }
  };
}

/** Drop-in for `onCall` that adds structured logging. Use INSIDE domain modules. */
export function loggedOnCall<R = unknown>(
  name: string,
  options: CallableOptions,
  handler: (req: CallableRequest) => R | Promise<R>,
) {
  return onCall(options, instrumentCallable(name, handler));
}
