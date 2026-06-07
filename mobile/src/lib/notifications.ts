import { Platform } from "react-native";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { db } from "./firebase";

let expoPushToken: string | null = null;

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: false,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export function canRegisterPushToken(): boolean {
  if (Platform.OS === "web") return false;
  return Device.isDevice;
}

export async function requestAndRegisterToken(uid: string): Promise<string | null> {
  if (!canRegisterPushToken()) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  const projectId =
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    Constants.easConfig?.projectId;
  const options: { projectId?: string } = projectId ? { projectId } : {};
  const tokenData = await Notifications.getExpoPushTokenAsync(options);
  const token = tokenData.data;
  expoPushToken = token;

  const tokenId = hashToken(token);
  await setDoc(doc(db, "deviceTokens", uid, "tokens", tokenId), {
    expoPushToken: token,
    platform: Platform.OS,
    updatedAt: new Date().toISOString(),
  });

  return token;
}

export async function registerPushToken(uid: string, token: string): Promise<void> {
  expoPushToken = token;
  const tokenId = hashToken(token);
  await setDoc(doc(db, "deviceTokens", uid, "tokens", tokenId), {
    expoPushToken: token,
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
