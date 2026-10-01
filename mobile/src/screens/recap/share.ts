/**
 * Recap sharing.
 *
 * Native: capture the card with react-native-view-shot and hand the PNG to the OS share
 * sheet (expo-sharing). Web: view-shot's web build rasterises the DOM node via
 * html2canvas; the PNG goes to the Web Share API when the browser can share files and
 * downloads otherwise. "Copy link" is the always-available web fallback. Modules are
 * imported lazily so html2canvas / the native share module only load when used.
 */
import { Platform, type View } from "react-native";

/** Web Share API with file support (mobile Safari/Chrome, some desktop browsers). */
export function canShareFilesOnWeb(): boolean {
  if (Platform.OS !== "web" || typeof navigator === "undefined" || typeof File === "undefined") {
    return false;
  }
  try {
    const probe = new File([""], "recap.png", { type: "image/png" });
    return typeof navigator.share === "function" && !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

/** PNG of the card: a tmp-file uri on native, a data: URI on web. */
export async function captureCard(view: View): Promise<string> {
  const { captureRef } = await import("react-native-view-shot");
  return Platform.OS === "web"
    ? captureRef(view, { format: "png", quality: 1, result: "data-uri" })
    : captureRef(view, { format: "png", quality: 1 });
}

/** Native share sheet. Returns false when this device can't share files at all. */
export async function shareImageNative(uri: string, dialogTitle: string): Promise<boolean> {
  const Sharing = await import("expo-sharing");
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle });
  return true;
}

function dataUriToFile(dataUri: string, fileName: string): File {
  const [, base64 = ""] = dataUri.split(",");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: "image/png" });
}

/**
 * Web: share the PNG through the system sheet when possible, else download it.
 * Resolves "cancelled" when the user dismisses the share sheet (not an error).
 */
export async function shareOrDownloadWeb(
  dataUri: string,
  fileName: string,
  title: string,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = dataUriToFile(dataUri, fileName);
  if (canShareFilesOnWeb()) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Some browsers advertise file sharing then refuse it — fall back to a download.
    }
  }
  const link = document.createElement("a");
  link.href = dataUri;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return "downloaded";
}

/** Copy text on web; false when the browser refuses (insecure origin, permissions). */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Async clipboard refused (unfocused document, iframe policy): try the legacy path.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
