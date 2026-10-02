// Sentry's wrapper extends Expo's default Metro config with debug IDs + source-map
// serialization so uploaded bundles symbolicate; without it stack traces stay minified.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("node:path");

const config = getSentryExpoConfig(__dirname);
// app.json disables Expo's app-root-only on-demand filesystem. The normal file
// map honors this explicit shared-code root in development and clean exports.
config.watchFolders = [
  ...new Set([...(config.watchFolders ?? []), path.resolve(__dirname, "../functions/src/models")]),
];

module.exports = config;
