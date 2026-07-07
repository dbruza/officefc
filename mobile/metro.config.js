// Firebase v10 predates the "react-native" exports condition on @firebase/app,
// so under Metro's package-exports resolution the bundle gets TWO copies of it:
// an ESM copy (where initializeApp registers the app) and a CJS copy required by
// @firebase/auth's React Native build (where the auth component registers).
// initializeAuth() then can't find "auth" on the app's copy and throws
// "Component auth has not been registered yet" — a redbox in dev, but a fatal
// launch crash in release builds. Classic main-field resolution is
// syntax-independent, so it collapses everything to one copy.
// Remove this once firebase is upgraded to ^12 (fixed upstream in
// firebase-js-sdk#9112; Expo now requires firebase >= 12 with exports enabled).
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
