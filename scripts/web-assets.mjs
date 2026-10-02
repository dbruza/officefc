import { basename } from "node:path";
export const REQUIRED_FONTS = [
  "Archivo_400Regular",
  "Archivo_500Medium",
  "Archivo_700Bold",
  "JetBrainsMono_500Medium",
  "JetBrainsMono_700Bold",
];
/** Metro may nest assets under a workspace-relative prefix when dependencies are linked. */
export function missingFontAssets(paths) {
  const names = paths.map((path) => basename(path));
  return REQUIRED_FONTS.filter(
    (font) =>
      !names.some((name) => name.startsWith(font + ".") && /\.(ttf|otf|woff2?)$/.test(name)),
  );
}
