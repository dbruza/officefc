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

interface AuthState {
  /** First auth check still pending. */
  initializing: boolean;
  /** Loading the profile/membership for a known user. */
  loadingProfile: boolean;
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
    } catch {
      // permission-denied / offline → treat as not-yet-set-up; routing falls back safely
      setProfile(null);
      setMembership(null);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setEmailVerified(!!u?.emailVerified);
      await loadProfileAndMembership(u);
      setInitializing(false);
    });
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
