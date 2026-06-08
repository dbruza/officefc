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

/** Call the Anthropic Messages API and return the parsed JSON response. */
export async function callClaude({
  apiKey,
  baseUrl = "https://api.anthropic.com",
  request,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error("callClaude: missing Anthropic API key");
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 500)}`);
  }
  return res.json();
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
