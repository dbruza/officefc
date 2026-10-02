/**
 * Auth + onboarding state for the app.
 *
 * Tracks the Firebase user plus their `profile` and league `membership`, which together
 * drive routing: signed-out → auth, unverified → verify, no profile → setup, no
 * membership → join, otherwise → app. Exposes the auth actions the screens call.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  reload,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";
import { getProfile, type Profile } from "./profiles";
import { getMembership, type Membership } from "./membership";
import { logger, setLogUid, STARTUP_SLOW_MS } from "./logger";
import { clearFocusDataCache } from "./useFocusData";

interface AuthState {
  /** First auth check still pending. */
  initializing: boolean;
  /** Loading the profile/membership for a known user. */
  loadingProfile: boolean;
  /**
   * The last profile/membership read threw (offline / Firestore unavailable). Distinct
   * from `profile === null`, which means the docs genuinely aren't there yet — routing
   * must not send a set-up user to onboarding because of a network blip.
   */
  profileReadFailed: boolean;
  user: User | null;
  /** Tracked separately so `reloadUser()` (which mutates the user in place) re-renders. */
  emailVerified: boolean;
  profile: Profile | null;
  membership: Membership | null;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Re-check email verification (after the user clicks the link). */
  reloadUser: () => Promise<void>;
  /** Re-fetch profile + membership (after setup / join). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileReadFailed, setProfileReadFailed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);

  const loadProfileAndMembership = useCallback(async (u: User | null) => {
    if (!u) {
      setProfile(null);
      setMembership(null);
      return;
    }
    setLoadingProfile(true);
    try {
      // Reads of one's own profile/membership are permitted pre-membership (see rules).
      const [p, m] = await Promise.all([getProfile(u.uid), getMembership(u.uid)]);
      setProfile(p);
      setMembership(m);
      setProfileReadFailed(false);
    } catch {
      // Offline / Firestore unavailable: the docs' absence was NOT established, so null
      // them (never carry another session's identity forward) but raise the flag — the
      // root navigator holds position and offers a retry instead of routing to onboarding.
      setProfile(null);
      setMembership(null);
      setProfileReadFailed(true);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    const bootStart = Date.now();
    let reported = false;
    // Beacon, not a timeout: if bootstrap is still unresolved after this long, emit a warn
    // (remote-logged + Sentry breadcrumb) so a wedged startup is visible from the outside —
    // the build-7 splash hang produced zero telemetry precisely because nothing ever fired.
    const stallTimer = setTimeout(() => {
      if (!reported) {
        logger.warn("auth_bootstrap_stalled", {
          afterMs: Date.now() - bootStart,
          signedIn: !!auth.currentUser,
        });
      }
    }, 10_000);
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      clearFocusDataCache();
      setUser(u);
      setEmailVerified(!!u?.emailVerified);
      setLogUid(u?.uid ?? null);
      await loadProfileAndMembership(u);
      setInitializing(false);
      if (!reported) {
        reported = true;
        clearTimeout(stallTimer);
        const durationMs = Date.now() - bootStart;
        // profile + membership ready — NOT first-screen data, hence the name. Escalate to
        // warn past the startup threshold so slow boots forward to Cloud Logging.
        const fields = { durationMs, signedIn: !!u };
        if (durationMs >= STARTUP_SLOW_MS) logger.warn("auth_bootstrap_ready", fields);
        else logger.info("auth_bootstrap_ready", fields);
      }
    });
    return () => {
      clearTimeout(stallTimer);
      unsubscribe();
    };
  }, [loadProfileAndMembership]);

  const signUp = useCallback(async (email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await sendEmailVerification(cred.user);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
    setLogUid(null);
    clearFocusDataCache();
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  }, []);

  const resendVerification = useCallback(async () => {
    if (auth.currentUser) await sendEmailVerification(auth.currentUser);
  }, []);

  const reloadUser = useCallback(async () => {
    if (!auth.currentUser) return;
    await reload(auth.currentUser);
    setEmailVerified(auth.currentUser.emailVerified);
  }, []);

  const refresh = useCallback(async () => {
    await loadProfileAndMembership(auth.currentUser);
  }, [loadProfileAndMembership]);

  return (
    <AuthContext.Provider
      value={{
        initializing,
        loadingProfile,
        profileReadFailed,
        user,
        emailVerified,
        profile,
        membership,
        signUp,
        signIn,
        signOutUser,
        resetPassword,
        resendVerification,
        reloadUser,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
