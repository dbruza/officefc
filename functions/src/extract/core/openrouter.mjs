// ESM (.mjs) on purpose: imported directly by the root `node --test` suite and compiled by functions tsc. Do not rename to .js.
/* OfficeFC — minimal OpenRouter chat-completions client for vision + schema-constrained JSON.
   Uses global fetch (available in Node >= 18). No SDK dependency, so the
   exact same module runs in the Cloud Function and in the Node eval harness. */

import { EXTRACTION_SCHEMA, EXTRACTION_SCHEMA_NAME, DEFAULT_MODEL } from "./schema.mjs";
import { SYSTEM_PROMPT, USER_INSTRUCTION } from "./prompt.mjs";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Build the chat-completions request body for one image. */
export function buildRequest({
  imageBase64,
  mediaType = "image/png",
  model = DEFAULT_MODEL,
  maxTokens = 4096,
  reasoningEffort = "low",
}) {
  if (!imageBase64) throw new Error("buildRequest: imageBase64 is required");
  return {
    model,
    // Reasoning tokens count against this cap too, so it leaves room for them plus the answer.
    max_tokens: maxTokens,
    // Transcribing printed numbers needs little reasoning, and the player is waiting on this call.
    reasoning: { effort: reasoningEffort },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
          { type: "text", text: USER_INSTRUCTION },
        ],
      },
    ],
    // Constrain the whole answer to the stats schema (structured output, no prose). Not a forced
    // function call: Meta's endpoint rejects any tool_choice other than "auto".
    response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA },
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
// Transient statuses worth retrying: rate limited (429), gateway/server (5xx), timeout/conflict.
// 402 (out of credits) and 403 (moderation) are not transient, so they fail at once.
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

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
 * Call OpenRouter's chat-completions API and return the parsed JSON response.
 *
 * Each attempt is bounded by `timeoutMs` (AbortController) so a wedged connection can't hang the
 * Cloud Function to its own deadline. Transient failures — network errors, timeouts, and
 * 408/409/429/5xx — are retried up to `maxAttempts` with exponential backoff, honoring
 * `retry-after`. Non-retryable responses (e.g. 400/401/402/403) throw immediately.
 */
export async function callModel({
  apiKey,
  baseUrl = OPENROUTER_BASE_URL,
  request,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  deadlineMs = Date.now() + 45000,
  sleepImpl = defaultSleep,
}) {
  if (!apiKey) throw new Error("callModel: missing OpenRouter API key");
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "x-title": "OfficeFC",
  };
  const body = JSON.stringify(request);

  let lastError;
  const waitBeforeRetry = async (ms) => {
    if (ms >= deadlineMs - Date.now()) throw lastError ?? new Error("Model deadline exceeded");
    await sleepImpl(ms);
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) throw lastError ?? new Error("Model deadline exceeded");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
    let res;
    try {
      res = await fetchImpl(url, { method: "POST", headers, body, signal: controller.signal });
    } catch (err) {
      // Network failure or aborted (timeout) — transient, so retry if attempts remain.
      clearTimeout(timer);
      lastError = new Error(`OpenRouter API request failed: ${err?.message ?? err}`);
      if (attempt < maxAttempts) {
        await waitBeforeRetry(backoffMs(attempt));
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

    const message = `OpenRouter API ${res.status}: ${detail.slice(0, 500)}`;
    if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
      lastError = new Error(message);
      await waitBeforeRetry(retryAfterMs(res) ?? backoffMs(attempt));
      continue;
    }
    throw new Error(message);
  }
  throw lastError ?? new Error("OpenRouter API: retries exhausted");
}

/** Pull the report_match_stats object out of a chat-completions response. */
export function extractStats(response) {
  if (response?.error) {
    throw new Error(
      `OpenRouter error: ${response.error.message ?? JSON.stringify(response.error)}`,
    );
  }
  const choice = response?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    const finishReason = choice?.finish_reason ?? "unknown";
    throw new Error(
      `No ${EXTRACTION_SCHEMA_NAME} JSON in model response (finish_reason: ${finishReason})`,
    );
  }
  // Strict schemas should come back bare, but tolerate a Markdown code fence around the JSON.
  const json = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`${EXTRACTION_SCHEMA_NAME} response was not valid JSON`);
  }
}

/** Helper for tests/mock mode: wrap a stats object as if the model returned it. */
export function mockResponse(stats) {
  return {
    id: "gen-mock",
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(stats) },
      },
    ],
  };
}
