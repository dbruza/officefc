import test from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_FONTS, missingFontAssets } from "../scripts/web-assets.mjs";
test("font validation accepts workspace-relative asset layouts", () => {
  assert.deepEqual(
    missingFontAssets(
      REQUIRED_FONTS.map((font) => `linked/workspace/node_modules/fonts/${font}.1234.ttf`),
    ),
    [],
  );
});
test("font validation rejects a missing weight and unrelated files", () => {
  const files = REQUIRED_FONTS.slice(1).map((font) => `node_modules/fonts/${font}.1234.ttf`);
  files.push("Archivo_400Regular.png");
  assert.deepEqual(missingFontAssets(files), ["Archivo_400Regular"]);
});
