import React from "react";
import { logger } from "@/lib/logger";

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
    logger.error("render_error", {
      message: error instanceof Error ? error.message : String(error),
      componentStack: info?.componentStack,
    });
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
