/* Offline end-to-end pipeline test using a mock model caller (no network).
   Proves: buildRequest → (mock) tool_use response → extractToolInput → normalize. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMatchFromImage } from "../functions/src/extract/core/extract.mjs";
import { mockResponse } from "../functions/src/extract/core/anthropic.mjs";
import { EXTRACTION_TOOL_NAME } from "../functions/src/extract/core/schema.mjs";

test("full pipeline with a mocked Claude response", async () => {
  let seenRequest = null;
  const caller = async (request) => {
    seenRequest = request;
    return mockResponse({
      detected_screen: true,
      confidence: 0.9,
      home: { team_name: "Riverside FC", goals: 2, possession: 55, shots: 11, shots_on_target: 6 },
      away: { team_name: "Harbour Athletic", goals: 4, possession: 45, shots: 13, shots_on_target: 8 },
    });
  };

  const result = await extractMatchFromImage({ imageBase64: "ZmFrZQ==", mediaType: "image/png", caller });

  // request was shaped correctly (forced tool use + image block)
  assert.equal(seenRequest.tool_choice.name, EXTRACTION_TOOL_NAME);
  assert.equal(seenRequest.messages[0].content[0].type, "image");
  assert.equal(seenRequest.messages[0].content[0].source.media_type, "image/png");

  // and the normalized suggestion is correct
  assert.equal(result.ok, true);
  assert.equal(result.requiresReview, false);
  assert.equal(result.suggestion.homeResult, "L"); // 2 < 4
  assert.equal(result.suggestion.away.goals, 4);
});

test("pipeline surfaces a missing tool_use block as an error", async () => {
  const caller = async () => ({ content: [{ type: "text", text: "I refuse to use the tool" }] });
  await assert.rejects(
    () => extractMatchFromImage({ imageBase64: "ZmFrZQ==", caller }),
    /No report_match_stats tool_use block/,
  );
});
