/* OfficeFC — extraction orchestrator: image bytes -> normalized suggestion.
   `caller` is injectable so tests/eval can run the full pipeline offline with a
   deterministic mock, while the Edge Function injects the real Anthropic call. */

import { buildRequest, callClaude, extractToolInput } from "./anthropic.mjs";
import { normalizeExtraction } from "./validate.mjs";
import { DEFAULT_MODEL } from "./schema.mjs";

/**
 * @param {object}   opts
 * @param {string}   opts.imageBase64       base64-encoded image bytes
 * @param {string}  [opts.mediaType]        e.g. "image/png" | "image/jpeg"
 * @param {string}  [opts.model]
 * @param {string}  [opts.apiKey]           required unless a custom `caller` is given
 * @param {string}  [opts.baseUrl]
 * @param {Function}[opts.caller]           async (request) => Anthropic Messages response
 * @returns normalized result from validate.normalizeExtraction
 */
export async function extractMatchFromImage(opts) {
  const { imageBase64, mediaType = "image/png", model = DEFAULT_MODEL, apiKey, baseUrl, caller } = opts;
  const request = buildRequest({ imageBase64, mediaType, model });

  const response = caller
    ? await caller(request)
    : await callClaude({ apiKey, baseUrl, request });

  const toolInput = extractToolInput(response);
  return normalizeExtraction(toolInput);
}
