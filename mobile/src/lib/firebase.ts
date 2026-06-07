/**
 * Firebase client init for the Expo app (Auth + Firestore + Storage).
 *
 * Config comes from public `EXPO_PUBLIC_FIREBASE_*` env vars (safe to ship — Firebase
 * web config is not secret; access is governed by security rules). In development,
 * set `EXPO_PUBLIC_USE_EMULATORS=1` to point Auth/Firestore/Storage at the local
 * Firebase Emulator Suite.
 */
import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  initializeAuth,
  // @ts-expect-error — RN persistence helper is exported but not in the web types
  getReactNativePersistence,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * On native, persist auth across restarts via AsyncStorage. On web, the default
 * persistence is used (initializeAuth with RN persistence throws there).
 */
export const auth =
  Platform.OS === "web"
    ? getAuth(app)
    : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });

export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

const useEmulators =
  process.env.EXPO_PUBLIC_USE_EMULATORS === "1" ||
  process.env.EXPO_PUBLIC_USE_EMULATORS === "true";

const webHostAllowsEmulators =
  Platform.OS !== "web" ||
  (typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));

if (useEmulators && webHostAllowsEmulators) {
  // Web + iOS simulator share the host's loopback, so `localhost` (→ the emulators' 127.0.0.1
  // binding) is correct. The Android emulator reaches the host via the 10.0.2.2 alias.
  // (Testing on a PHYSICAL device against emulators needs extra setup: start the emulators
  // bound to 0.0.0.0 and point this at the dev machine's LAN IP.)
  const host = Platform.OS === "android" ? "10.0.2.2" : "localhost";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
  connectFunctionsEmulator(functions, host, 5001);
}

export { app };
