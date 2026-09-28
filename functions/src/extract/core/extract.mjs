// ESM (.mjs) on purpose: imported directly by the root `node --test` suite and compiled by functions tsc. Do not rename to .js.
/* OfficeFC — extraction orchestrator: image bytes -> normalized suggestion.
   `caller` is injectable so tests/eval can run the full pipeline offline with a
   deterministic mock, while the Cloud Function makes the real OpenRouter call. */

import { buildRequest, callModel, extractStats } from "./openrouter.mjs";
import { normalizeExtraction } from "./validate.mjs";
import { DEFAULT_MODEL } from "./schema.mjs";

/**
 * @param {object}   opts
 * @param {string}   opts.imageBase64       base64-encoded image bytes
 * @param {string}  [opts.mediaType]        e.g. "image/png" | "image/jpeg"
 * @param {string}  [opts.model]
 * @param {string}  [opts.apiKey]           required unless a custom `caller` is given
 * @param {string}  [opts.baseUrl]
 * @param {Function}[opts.caller]           async (request) => chat-completions response
 * @returns normalized result from validate.normalizeExtraction
 */
export async function extractMatchFromImage(opts) {
  const {
    imageBase64,
    mediaType = "image/png",
    model = DEFAULT_MODEL,
    apiKey,
    baseUrl,
    caller,
  } = opts;
  const request = buildRequest({ imageBase64, mediaType, model });

  const response = caller ? await caller(request) : await callModel({ apiKey, baseUrl, request });

  return normalizeExtraction(extractStats(response));
}
