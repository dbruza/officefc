// ESM (.mjs) on purpose: imported directly by the root `node --test` suite and compiled by functions tsc. Do not rename to .js.
/* OfficeFC — minimal Anthropic Messages client for vision + forced tool use.
   Uses global fetch (available in Node >= 18). No SDK dependency, so the
   exact same module runs in the Cloud Function and in the Node eval harness. */

import {
  EXTRACTION_TOOL,
  EXTRACTION_TOOL_NAME,
  DEFAULT_MODEL,
  ANTHROPIC_VERSION,
} from "./schema.mjs";
import { SYSTEM_PROMPT, USER_INSTRUCTION } from "./prompt.mjs";

/** Build the Messages API request body for one image. */
export function buildRequest({
  imageBase64,
  mediaType = "image/png",
  model = DEFAULT_MODEL,
  maxTokens = 512,
}) {
  if (!imageBase64) throw new Error("buildRequest: imageBase64 is required");
  return {
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    // Force the model to answer through the tool (structured output, no prose).
    tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: USER_INSTRUCTION },
        ],
      },
    ],
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
// Transient statuses worth retrying: overloaded (429/529), gateway/server (5xx), timeout/conflict.
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff in ms for a 1-based attempt: 0.5s, 1s, 2s, … */
function backoffMs(attempt) {
  return 500 * 2 ** (attempt - 1);
}

/** Honor a `retry-after` (seconds) response header when present, else null. */
function retryAfterMs(res) {
  const header =
    res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : null;
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/**
 * Call the Anthropic Messages API and return the parsed JSON response.
 *
 * Each attempt is bounded by `timeoutMs` (AbortController) so a wedged connection can't hang the
 * Cloud Function to its own deadline. Transient failures — network errors, timeouts, and
 * 408/409/429/5xx/529 — are retried up to `maxAttempts` with exponential backoff, honoring
 * `retry-after`. Non-retryable responses (e.g. 400/401/403) throw immediately.
 */
export async function callClaude({
  apiKey,
  baseUrl = "https://api.anthropic.com",
  request,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  sleepImpl = defaultSleep,
}) {
  if (!apiKey) throw new Error("callClaude: missing Anthropic API key");
  const url = `${baseUrl.replace(/\/$/, "")}/v1/messages`;
  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
  const body = JSON.stringify(request);

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { method: "POST", headers, body, signal: controller.signal });
    } catch (err) {
      // Network failure or aborted (timeout) — transient, so retry if attempts remain.
      clearTimeout(timer);
      lastError = new Error(`Anthropic API request failed: ${err?.message ?? err}`);
      if (attempt < maxAttempts) {
        await sleepImpl(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }

    // Read the body while the abort timer is still armed, so a hung body read also times out.
    if (res.ok) {
      try {
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    }
    const detail = await res.text().catch(() => "");
    clearTimeout(timer);

    const message = `Anthropic API ${res.status}: ${detail.slice(0, 500)}`;
    if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
      lastError = new Error(message);
      await sleepImpl(retryAfterMs(res) ?? backoffMs(attempt));
      continue;
    }
    throw new Error(message);
  }
  throw lastError ?? new Error("Anthropic API: retries exhausted");
}

/** Pull the report_match_stats tool input out of a Messages API response. */
export function extractToolInput(response) {
  const blocks = (response && response.content) || [];
  const toolBlock = blocks.find(
    (b) => b && b.type === "tool_use" && b.name === EXTRACTION_TOOL_NAME,
  );
  if (!toolBlock) throw new Error("No report_match_stats tool_use block in model response");
  return toolBlock.input;
}

/** Helper for tests/mock mode: wrap a tool input as if the model returned it. */
export function mockResponse(toolInput) {
  return {
    id: "msg_mock",
    role: "assistant",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "toolu_mock", name: EXTRACTION_TOOL_NAME, input: toolInput }],
  };
}
