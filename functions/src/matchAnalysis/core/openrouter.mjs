// ESM (.mjs) on purpose: imported directly by the root `node --test` suite and compiled by functions tsc. Do not rename to .js.
/* OfficeFC — OpenRouter chat-completions client for match analysis.
   Same shape as extract/core/anthropic.mjs: global fetch, injected deps for tests,
   bounded retries on transient failures. Free models rotate often and rate-limit hard,
   so callers pass a fallback CHAIN and this client walks it. */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
// Transient statuses worth retrying within one model before falling through the chain:
// rate limit, gateway/server errors, provider overload.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff in ms for a 1-based attempt: 0.5s, 1s, 2s, … */
function backoffMs(attempt) {
  return 500 * 2 ** (attempt - 1);
}

function retryAfterMs(res) {
  const header =
    res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : null;
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** Build the chat-completions request body for one analysis turn. */
export function buildChatRequest({ systemPrompt, userPrompt, model, maxTokens = 900 }) {
  if (!model) throw new Error("buildChatRequest: model is required");
  return {
    model,
    max_tokens: maxTokens,
    temperature: 0.6,
    // Some free "reasoning" models ignore temperature; harmless to send.
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
}

/**
 * POST one request to OpenRouter and return { content } from the first non-empty choice.
 * Throws Error with a `status` property attached on non-2xx so the chain runner can
 * distinguish transient from permanent failures without string matching.
 *
 * @param {object} opts
 * @param {string} opts.apiKey          OpenRouter API key
 * @param {object} opts.request         chat-completions body (see buildChatRequest)
 * @param {string} [opts.baseUrl]       override for tests
 * @param {Function} [opts.fetchImpl]   injectable fetch (tests)
 * @param {Function} [opts.sleepImpl]   injectable sleep (tests)
 */
export async function callOpenRouter(opts) {
  const {
    apiKey,
    request,
    baseUrl = "https://openrouter.ai/api/v1",
    fetchImpl = (...args) => fetch(...args),
    sleepImpl = defaultSleep,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    deadlineMs = Date.now() + 45000,
  } = opts;
  if (!apiKey) throw new Error("callOpenRouter: apiKey is required");

  let lastError;
  const waitBeforeRetry = async (ms) => {
    if (ms >= deadlineMs - Date.now()) throw lastError ?? new Error("Model deadline exceeded");
    await sleepImpl(ms);
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) throw lastError ?? new Error("Model deadline exceeded");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Optional attribution headers per OpenRouter docs.
          "HTTP-Referer": "https://officefc.app",
          "X-Title": "OfficeFC",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < maxAttempts) {
        await waitBeforeRetry(backoffMs(attempt));
        continue;
      }
      throw error;
    }
    if (res.ok) {
      let body;
      try {
        body = await res.json();
      } finally {
        clearTimeout(timer);
      }
      const choice = Array.isArray(body?.choices) ? body.choices[0] : undefined;
      const content =
        typeof choice?.message?.content === "string"
          ? choice.message.content
          : // Reasoning models sometimes put prose in reasoning_content with empty content.
            typeof choice?.message?.reasoning_content === "string"
            ? choice.message.reasoning_content
            : "";
      if (!content.trim()) {
        lastError = Object.assign(new Error("Model returned an empty completion"), {
          status: 502,
        });
        if (attempt < maxAttempts) {
          await waitBeforeRetry(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }
      return { content };
    }

    const status = res.status;
    let detail;
    try {
      detail = await res.text();
    } catch {
      detail = "";
    } finally {
      clearTimeout(timer);
    }
    lastError = Object.assign(new Error(`OpenRouter ${status}: ${detail.slice(0, 300)}`), {
      status,
    });
    if (RETRYABLE_STATUS.has(status) && attempt < maxAttempts) {
      const wait = retryAfterMs(res) ?? backoffMs(attempt);
      await waitBeforeRetry(wait);
      continue;
    }
    throw lastError;
  }
  /* c8 ignore next — loop always returns or throws */
  throw lastError ?? new Error("callOpenRouter: exhausted attempts");
}

/**
 * Walk a model chain until one call succeeds AND its output parses/validates.
 * Each model gets up to `maxAttempts` transport tries; a validate failure counts as a
 * failed try for that model and moves on. Returns { content, model } or throws when every
 * model fails (the caller then produces the deterministic fallback).
 *
 * @param {object} opts
 * @param {string[]} opts.models            ordered model ids to try
 * @param {string}  opts.apiKey             OpenRouter API key
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.deadlineMs]
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.sleepImpl]
 * @param {object}  opts.requestOpts        { systemPrompt, userPrompt, maxTokens? }
 * @param {(content: string, model: string) => any} [opts.validate]
 *        throws on unusable output; defaults to returning the raw text
 */
export async function callWithFallbackChain(opts) {
  const { models, apiKey, requestOpts, validate, ...callOpts } = opts;
  const deadlineMs = opts.deadlineMs ?? Date.now() + 45000;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("callWithFallbackChain: models must be a non-empty array");
  }
  const check = validate ?? ((content) => content);
  let lastError;
  for (const model of models) {
    const request = buildChatRequest({ ...requestOpts, model });
    try {
      const { content } = await callOpenRouter({ ...callOpts, deadlineMs, apiKey, request });
      return { content: check(content, model), model };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("callWithFallbackChain: all models failed");
}
