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

function chooseWebFile(source: "camera" | "library"): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/heic,image/heif";
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
  if (!file) return null;
  if (!file.type.startsWith("image/")) {
    throw new PhotoPickerError("unsupported", "Choose a JPEG, PNG, WebP, HEIC, or HEIF image.");
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
