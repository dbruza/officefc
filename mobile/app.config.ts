/**
 * Per-deployment identity for native builds, layered over app.json (which keeps everything
 * shared, including the version `npm run version:sync` writes). The web build and local
 * development need none of these; EAS builds read them from EAS environment variables.
 *
 * - OFFICEFC_BUNDLE_ID: iOS bundle identifier and Android package (one you own).
 * - OFFICEFC_EAS_PROJECT_ID / OFFICEFC_EAS_OWNER: the EAS project the builds belong to.
 * - SENTRY_ORG / SENTRY_PROJECT: read by the Sentry plugin itself for source-map uploads.
 */
import type { ConfigContext, ExpoConfig } from "expo/config";

const env = (name: string) => process.env[name]?.trim() || undefined;

export default ({ config }: ConfigContext): ExpoConfig => {
  const bundleId = env("OFFICEFC_BUNDLE_ID") ?? "com.example.officefc";
  const easProjectId = env("OFFICEFC_EAS_PROJECT_ID");
  const owner = env("OFFICEFC_EAS_OWNER");
  return {
    ...config,
    name: config.name ?? "OfficeFC",
    slug: config.slug ?? "officefc",
    ...(owner ? { owner } : {}),
    ios: { ...config.ios, bundleIdentifier: bundleId },
    android: { ...config.android, package: bundleId },
    plugins: [...(config.plugins ?? []), "@sentry/react-native/expo"],
    extra: { ...config.extra, ...(easProjectId ? { eas: { projectId: easProjectId } } : {}) },
  };
};
