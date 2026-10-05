/** Account deletion (App Store guideline 5.1.1(v)). The server does the erasing. */
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "./firebase";

/**
 * Confirm the password, then delete the account. The function refuses tokens from sign-ins
 * older than ten minutes, so re-authenticating here is what lets it run.
 */
export async function deleteAccount(password: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email)
    throw Object.assign(new Error("Sign in again first."), { code: "auth/no-user" });
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  await user.getIdToken(true);
  const callable = httpsCallable<Record<string, never>, { ok: boolean }>(
    functions,
    "deleteAccount",
  );
  await callable({});
}
