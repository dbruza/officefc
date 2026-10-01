/**
 * Cross-platform alert/confirm/choice dialogs. Native uses the system Alert. On web,
 * react-native-web's Alert is a silent no-op and window.confirm is unstyled, blocking,
 * and ignores button labels — so web requests go to the in-app <DialogHost/> (mounted
 * in the root layout), with window.alert/confirm only as a fallback if it isn't mounted.
 */
import { Alert, Platform } from "react-native";

export type DialogOptionStyle = "default" | "cancel" | "destructive" | "primary";

export interface DialogOption {
  label: string;
  style?: DialogOptionStyle;
  onPress?: () => void;
}

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  options: DialogOption[];
}

type Listener = (queue: DialogRequest[]) => void;

let nextId = 1;
let queue: DialogRequest[] = [];
let listener: Listener | null = null;

/** Called by DialogHost. Only one host is expected; the latest registration wins. */
export function subscribeDialogs(fn: Listener): () => void {
  listener = fn;
  fn(queue);
  return () => {
    if (listener === fn) listener = null;
  };
}

/** DialogHost calls this when the front dialog closes. */
export function dismissDialog(id: number): void {
  queue = queue.filter((d) => d.id !== id);
  listener?.(queue);
}

function present(title: string, message: string | undefined, options: DialogOption[]): void {
  if (Platform.OS !== "web") {
    Alert.alert(
      title,
      message,
      options.map((o) => ({
        text: o.label,
        style: o.style === "primary" ? "default" : o.style,
        onPress: o.onPress,
      })),
    );
    return;
  }
  if (!listener) {
    // Host not mounted (very early boot): degrade to the browser's own dialogs.
    const text = message ? `${title}\n\n${message}` : title;
    const actionable = options.filter((o) => o.style !== "cancel");
    if (actionable.length <= 1 && options.length <= 1) {
      window.alert(text);
      actionable[0]?.onPress?.();
    } else if (window.confirm(text)) {
      actionable[actionable.length - 1]?.onPress?.();
    }
    return;
  }
  queue = [...queue, { id: nextId++, title, message, options }];
  listener(queue);
}

export function showAlert(title: string, message?: string): void {
  present(title, message, [{ label: "OK", style: "primary" }]);
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Label for the dismiss button (default "Cancel"). */
  cancelLabel?: string;
}

export function confirmAction({
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  cancelLabel = "Cancel",
}: ConfirmOptions): void {
  present(title, message, [
    { label: cancelLabel, style: "cancel" },
    { label: confirmLabel, style: destructive ? "destructive" : "primary", onPress: onConfirm },
  ]);
}

/**
 * Multi-option dialog (e.g. "Advance Sam" / "Advance Alex" / Cancel). Include a
 * `style: "cancel"` option so Escape has something to map to.
 */
export function chooseAction({
  title,
  message,
  options,
}: {
  title: string;
  message?: string;
  options: DialogOption[];
}): void {
  present(title, message, options);
}
