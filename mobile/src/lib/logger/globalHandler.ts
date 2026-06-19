import { logger, flush } from "./index";

let installed = false;

type ErrorUtilsShape = {
  getGlobalHandler?: () => (e: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
};

/**
 * Best-effort, NON-FATAL capture. A fatal crash usually terminates before the async flush
 * lands; this chains (never replaces) the existing handler so the original fatal path runs.
 */
export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  const errorUtils = (globalThis as unknown as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  const prev = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error, isFatal) => {
    try {
      logger.error("uncaught_error", {
        isFatal: !!isFatal,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      void flush();
    } finally {
      prev?.(error, isFatal); // never swallow the original handler
    }
  });
}
