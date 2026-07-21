// Sentry's wrapper extends Expo's default Metro config with debug IDs + source-map
// serialization so uploaded bundles symbolicate; without it stack traces stay minified.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
