import React from "react";
import * as Sentry from "@sentry/react-native";
import { logger, RENDER_ERROR_EVENT } from "@/lib/logger";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/** Catches render errors only (NOT event-handler or async errors) and logs them best-effort. */
export class LogErrorBoundary extends React.Component<Props, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    // A boundary swallows the error before Sentry's global handler can see it, so report
    // the real exception here (the logger's "render_error" event is breadcrumb/CL-only).
    Sentry.captureException(error, { extra: { componentStack: info?.componentStack } });
    logger.error(RENDER_ERROR_EVENT, {
      message: error instanceof Error ? error.message : String(error),
      componentStack: info?.componentStack,
    });
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
