/**
 * Non-blocking feedback ("Match logged", "Code copied"). Module-level store rendered by
 * <ToastHost/> in the root layout. Prefer this over showAlert for success messages —
 * an alert makes the user dismiss good news.
 */
export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /** Optional inline action (e.g. "View", "Undo"). */
  action?: { label: string; onPress: () => void };
  duration: number;
}

type Listener = (toasts: Toast[]) => void;

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((fn) => fn(toasts));
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  fn(toasts);
  return () => {
    listeners.delete(fn);
  };
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(tone: ToastTone, message: string, opts: Partial<Pick<Toast, "action" | "duration">>) {
  const toast: Toast = {
    id: nextId++,
    message,
    tone,
    action: opts.action,
    duration: opts.duration ?? (tone === "error" ? 5000 : 3200),
  };
  // Keep at most three on screen; the oldest makes way.
  toasts = [...toasts.slice(-2), toast];
  emit();
  return toast.id;
}

type Opts = Partial<Pick<Toast, "action" | "duration">>;

export const toast = {
  success: (message: string, opts: Opts = {}) => push("success", message, opts),
  error: (message: string, opts: Opts = {}) => push("error", message, opts),
  info: (message: string, opts: Opts = {}) => push("info", message, opts),
};
