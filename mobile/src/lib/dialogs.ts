/**
 * Cross-platform alert/confirm. react-native-web's Alert is a no-op, so native
 * dialogs would silently swallow errors and confirmations on the web build —
 * fall back to window.alert/window.confirm there.
 */
import { Alert, Platform } from "react-native";

export function showAlert(title: string, message?: string): void {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export function confirmAction({
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
}: ConfirmOptions): void {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: onConfirm },
  ]);
}
