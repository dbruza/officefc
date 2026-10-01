import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

const MAX_EDGE = 2048;
const MAX_SOURCE_SIZE = 25 * 1024 * 1024;
const JPEG_QUALITY = 0.86;

export interface SelectedMatchPhoto {
  uri: string;
  mimeType: "image/jpeg";
  fileSize?: number;
  width?: number;
  height?: number;
}

export class PhotoPickerError extends Error {
  constructor(
    public readonly code: "permission_denied" | "unsupported" | "too_large" | "processing_failed",
    message: string,
  ) {
    super(message);
    this.name = "PhotoPickerError";
  }
}

function targetSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function pickNative(source: "camera" | "library"): Promise<SelectedMatchPhoto | null> {
  const permission =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (permission.status !== "granted") {
    throw new PhotoPickerError(
      "permission_denied",
      source === "camera" ? "Camera permission is needed." : "Photo library access is needed.",
    );
  }

  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 1,
          allowsEditing: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 1,
          allowsEditing: false,
        });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  if (asset.fileSize && asset.fileSize > MAX_SOURCE_SIZE) {
    throw new PhotoPickerError("too_large", "That image is too large. Choose a photo under 25 MB.");
  }

  const size = targetSize(asset.width, asset.height);
  const actions =
    size.width === asset.width && size.height === asset.height
      ? []
      : [{ resize: { width: size.width, height: size.height } }];
  const normalized = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return {
    uri: normalized.uri,
    mimeType: "image/jpeg",
    width: normalized.width,
    height: normalized.height,
  };
}

/**
 * Only WebKit (Safari, and every iOS browser) can decode HEIC/HEIF in an <img>. Offering
 * them elsewhere lets a Chrome/Firefox user pick a file we then can't read, so the picker
 * only lists them where they'll work (iOS also converts HEIC to JPEG on pick when it isn't
 * listed, so leaving it out there would be harmless too).
 */
function browserDecodesHeic(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android/.test(ua);
}

const WEB_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const HEIC_TYPES = ["image/heic", "image/heif"];

function acceptedWebTypes(): string[] {
  return browserDecodesHeic() ? [...WEB_IMAGE_TYPES, ...HEIC_TYPES] : WEB_IMAGE_TYPES;
}

function acceptedTypesLabel(): string {
  return browserDecodesHeic() ? "JPEG, PNG, WebP, HEIC, or HEIF" : "JPEG, PNG, or WebP";
}

function chooseWebFile(source: "camera" | "library"): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = acceptedWebTypes().join(",");
    if (source === "camera") input.setAttribute("capture", "environment");
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleFocus);
      input.remove();
      resolve(file);
    };
    const handleFocus = () => {
      window.setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 300);
    };

    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    window.addEventListener("focus", handleFocus);
    input.click();
  });
}

function loadWebImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new PhotoPickerError(
          "unsupported",
          "This browser could not read that image. Try a JPEG, PNG, or WebP file.",
        ),
      );
    };
    image.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new PhotoPickerError("processing_failed", "Could not prepare that image.")),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new PhotoPickerError("processing_failed", "Could not read that image."));
    reader.readAsDataURL(blob);
  });
}

async function pickWeb(source: "camera" | "library"): Promise<SelectedMatchPhoto | null> {
  const file = await chooseWebFile(source);
  return file ? prepareWebImageFile(file) : null;
}

/**
 * Web: normalise an image File (picked, dropped, or pasted) to a ≤2048px JPEG data URI —
 * the same shape the picker produces, so upload/extraction can't tell them apart.
 */
export async function prepareWebImageFile(file: File): Promise<SelectedMatchPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new PhotoPickerError("unsupported", `Choose a ${acceptedTypesLabel()} image.`);
  }
  if (HEIC_TYPES.includes(file.type.toLowerCase()) && !browserDecodesHeic()) {
    throw new PhotoPickerError(
      "unsupported",
      "This browser can't read HEIC photos. Export it as JPEG or PNG, or use Safari.",
    );
  }
  if (file.size > MAX_SOURCE_SIZE) {
    throw new PhotoPickerError("too_large", "That image is too large. Choose a photo under 25 MB.");
  }

  const image = await loadWebImage(file);
  const size = targetSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new PhotoPickerError("processing_failed", "This browser could not prepare the image.");
  }
  context.drawImage(image, 0, 0, size.width, size.height);
  const blob = await canvasToJpeg(canvas);

  return {
    uri: await blobToDataUri(blob),
    mimeType: "image/jpeg",
    fileSize: blob.size,
    width: size.width,
    height: size.height,
  };
}

export async function pickMatchPhoto(
  source: "camera" | "library",
): Promise<SelectedMatchPhoto | null> {
  return Platform.OS === "web" ? pickWeb(source) : pickNative(source);
}

/**
 * Whether "Take a photo" makes sense here: always on native; on web only for touch-first
 * devices (a phone browser can open the camera; a desktop with a webcam shouldn't offer it,
 * whatever the window width).
 */
export function canUseCamera(): boolean {
  if (Platform.OS !== "web") return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}
