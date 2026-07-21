/**
 * Sentry crash + error reporting. Complements the Cloud Logging pipeline (src/lib/logger):
 * Sentry owns crashes (native + fatal JS — persisted and uploaded on next launch, which the
 * async ingestLog flush can never guarantee) plus explicit error events; the logger keeps
 * feeding warn/error batches to ingestLog unchanged.
 *
 * Init runs at MODULE SCOPE and this module must stay import-light (no logger/firebase):
 * app/_layout.tsx imports it FIRST so Sentry's handlers install before the firebase/auth
 * dependency graph evaluates — a crash during those imports (the store-build-3 failure
 * class) is only visible if Sentry is already initialized.
 */
import * as Sentry from "@sentry/react-native";
import { isRunningInExpoGo } from "expo";

declare const __DEV__: boolean;

// DSNs are public identifiers (safe to ship in the bundle); set per-profile in eas.json.
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";

/** Turns route changes into transactions/breadcrumbs; registered on the root nav container. */
export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: !isRunningInExpoGo(),
});

Sentry.init({
  dsn: DSN,
  // Dev builds keep local console/logger output only; no remote reporting.
  enabled: !__DEV__ && DSN.length > 0,
  environment: process.env.EXPO_PUBLIC_SENTRY_ENV ?? (__DEV__ ? "development" : "production"),
  integrations: [navigationIntegration],
  tracesSampleRate: 0.2,
});

if (!__DEV__ && DSN.length === 0) {
  // A release build without a DSN is indistinguishable from "no crashes" — surface it in the
  // remote log pipeline. Lazily required so this module stays ahead of the firebase graph.
  const { logger } = require("./logger") as typeof import("./logger");
  logger.warn("sentry_disabled", { reason: "EXPO_PUBLIC_SENTRY_DSN is unset" });
}
