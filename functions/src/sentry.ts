/**
 * Sentry error reporting for Cloud Functions. Init runs at module load (index.ts imports this
 * first). Only server faults are reported — expected client rejections stay in Cloud Logging —
 * and every capture is flushed before rethrowing, because a serverless instance can be frozen
 * the moment the response is sent, losing any background send.
 */
import * as Sentry from "@sentry/node";
import * as logger from "firebase-functions/logger";

// The DSN comes solely from the SENTRY_DSN env var (functions/.env on the deploying machine —
// the file is gitignored, so it must exist wherever `firebase deploy` runs). DSNs are public
// identifiers, not secrets. When unset, Sentry is disabled entirely.
const SENTRY_DSN = process.env.SENTRY_DSN ?? "";
const IN_EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";

/** Bounds fault-path latency: a report either sends quickly or likely won't send at all. */
const FLUSH_TIMEOUT_MS = 2000;

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_DSN.length > 0 && !IN_EMULATOR,
  environment: "production", // emulator runs never send events (enabled is false there)
  tracesSampleRate: 0, // errors only; Cloud Logging already carries timing
  // Errors-only means the OpenTelemetry machinery is never used — skipping it avoids
  // require-hook and integration setup cost on every cold start.
  skipOpenTelemetrySetup: true,
  // "strict" preserves Node's fatal unhandled-rejection semantics (capture, then exit).
  // The SDK default "warn" would swallow rejections that currently fail the invocation.
  integrations: [Sentry.onUnhandledRejectionIntegration({ mode: "strict" })],
});

// A prod deploy without a DSN silently no-ops every capture — make that visible.
if (!IN_EMULATOR && SENTRY_DSN.length === 0) {
  logger.warn("sentry_disabled", { reason: "SENTRY_DSN is unset" });
}

/** Report a server fault with function/user context, then wait for the send. Never throws. */
export async function captureServerFault(
  error: unknown,
  context: { fn: string; uid?: string | null; durationMs?: number },
): Promise<void> {
  try {
    Sentry.withScope((scope) => {
      scope.setTag("fn", context.fn);
      if (context.uid) scope.setUser({ id: context.uid });
      if (context.durationMs != null) scope.setExtra("durationMs", context.durationMs);
      Sentry.captureException(error);
    });
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  } catch {
    // Reporting must never mask the original failure.
  }
}

interface CaptureDeps {
  capture?: typeof captureServerFault;
}

/**
 * Wrap a background handler (onSchedule, onDocumentCreated, …) so failures reach Sentry —
 * unlike callables they have no instrumentCallable wrapper. The error is rethrown so the
 * runtime still records the failed execution.
 */
export function instrumentBackground<EventT>(
  name: string,
  handler: (event: EventT) => Promise<void>,
  deps: CaptureDeps = {},
): (event: EventT) => Promise<void> {
  const capture = deps.capture ?? captureServerFault;
  return async (event) => {
    try {
      await handler(event);
    } catch (error) {
      // Guarded (incl. sync throws) so a faulty capture impl can never replace the error.
      try {
        await capture(error, { fn: name });
      } catch {
        // Reporting must never mask the original failure.
      }
      throw error;
    }
  };
}
