import { Platform } from "react-native";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "./firebase";

let expoPushToken: string | null = null;

export function canRegisterPushToken(): boolean {
  if (Platform.OS === "web") return false;
  return true;
}

export async function registerPushToken(uid: string, token: string): Promise<void> {
  expoPushToken = token;
  const tokenId = hashToken(token);
  await setDoc(doc(db, "deviceTokens", uid, "tokens", tokenId), {
    token,
    platform: Platform.OS,
    updatedAt: new Date().toISOString(),
  });
}

export async function unregisterPushToken(uid: string, token: string): Promise<void> {
  const tokenId = hashToken(token);
  await deleteDoc(doc(db, "deviceTokens", uid, "tokens", tokenId));
  expoPushToken = null;
}

export function getCachedPushToken(): string | null {
  return expoPushToken;
}

function hashToken(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const chr = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `tok_${Math.abs(hash).toString(36)}`;
}

export function resolveNotificationRoute(data: Record<string, string>): string | null {
  const type = data.type;
  const matchId = data.matchId;
  if (!type) return null;
  switch (type) {
    case "match_pending":
      return matchId ? `/(app)/match/${matchId}` : "/(app)";
    case "match_confirmed":
      return matchId ? `/(app)/match/${matchId}` : "/(app)";
    case "match_disputed":
      return matchId ? `/(app)/match/${matchId}` : "/(app)";
    default:
      return "/(app)";
  }
}
