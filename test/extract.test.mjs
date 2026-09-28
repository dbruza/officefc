/* Offline end-to-end pipeline test using a mock model caller (no network).
   Proves: buildRequest → (mock) JSON response → extractStats → normalize. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMatchFromImage } from "../functions/src/extract/core/extract.mjs";
import { extractStats, mockResponse } from "../functions/src/extract/core/openrouter.mjs";
import { EXTRACTION_SCHEMA } from "../functions/src/extract/core/schema.mjs";

test("full pipeline with a mocked model response", async () => {
  let seenRequest = null;
  const caller = async (request) => {
    seenRequest = request;
    return mockResponse({
      detected_screen: true,
      confidence: 0.9,
      home: { team_name: "Riverside FC", goals: 2, possession: 55, shots: 11, shots_on_target: 6 },
      away: {
        team_name: "Harbour Athletic",
        goals: 4,
        possession: 45,
        shots: 13,
        shots_on_target: 8,
      },
    });
  };

  const result = await extractMatchFromImage({
    imageBase64: "ZmFrZQ==",
    mediaType: "image/png",
    caller,
  });

  // request was shaped correctly (schema-constrained JSON + image part)
  assert.equal(seenRequest.model, "meta/muse-spark-1.3-contributor");
  assert.deepEqual(seenRequest.response_format, {
    type: "json_schema",
    json_schema: EXTRACTION_SCHEMA,
  });
  assert.equal(EXTRACTION_SCHEMA.strict, true);
  // Meta's endpoint rejects a named tool_choice, so the request must not force one.
  assert.equal("tool_choice" in seenRequest, false);
  // Muse Spark always reasons, and reasoning shares max_tokens with the call: keep it low.
  assert.deepEqual(seenRequest.reasoning, { effort: "low" });
  assert.ok(seenRequest.max_tokens >= 4096);
  assert.equal(seenRequest.messages[0].role, "system");
  const [image] = seenRequest.messages[1].content;
  assert.equal(image.type, "image_url");
  assert.equal(image.image_url.url, "data:image/png;base64,ZmFrZQ==");

  // and the normalized suggestion is correct
  assert.equal(result.ok, true);
  assert.equal(result.requiresReview, false);
  assert.equal(result.suggestion.homeResult, "L"); // 2 < 4
  assert.equal(result.suggestion.away.goals, 4);
});

test("pipeline surfaces a missing answer as an error", async () => {
  const caller = async () => ({
    choices: [{ finish_reason: "length", message: { role: "assistant", content: null } }],
  });
  await assert.rejects(
    () => extractMatchFromImage({ imageBase64: "ZmFrZQ==", caller }),
    /No report_match_stats JSON in model response \(finish_reason: length\)/,
  );
});

test("an answer that isn't JSON, or an upstream error body, is an error", () => {
  const response = mockResponse({});
  response.choices[0].message.content = "{not json";
  assert.throws(() => extractStats(response), /not valid JSON/);
  assert.throws(
    () => extractStats({ error: { message: "Provider returned error" } }),
    /OpenRouter error: Provider returned error/,
  );
});

test("a JSON answer wrapped in a Markdown code fence still parses", () => {
  const response = mockResponse({});
  response.choices[0].message.content = '```json\n{"detected_screen": false}\n```';
  assert.deepEqual(extractStats(response), { detected_screen: false });
});
