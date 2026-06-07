/* OfficeFC — extraction tool schema.
   Runtime-agnostic (plain ESM): imported by the Cloud Function AND by the
   Node test/eval harness. Defines the single tool Claude must call so it returns
   structured data instead of prose. */

// Per-side stat shape. Every numeric field is nullable: the model returns null
// for anything it cannot read clearly (we never want a guessed score).
const SIDE_SCHEMA = {
  type: "object",
  properties: {
    team_name: { type: ["string", "null"], description: "Team name printed on this side, or null if unreadable." },
    goals: { type: ["integer", "null"], description: "Goals/score for this side. null ONLY if not clearly legible — never guess." },
    possession: { type: ["number", "null"], description: "Possession percentage for this side, 0–100, or null." },
    shots: { type: ["integer", "null"], description: "Total shots for this side, or null." },
    shots_on_target: { type: ["integer", "null"], description: "Shots on target for this side, or null." },
  },
  required: ["team_name", "goals", "possession", "shots", "shots_on_target"],
  additionalProperties: false,
};

export const EXTRACTION_TOOL_NAME = "report_match_stats";

export const EXTRACTION_TOOL = {
  name: EXTRACTION_TOOL_NAME,
  description:
    "Report the final result and key statistics read from a football video-game " +
    "(EA Sports FC / FIFA) end-of-match / full-time stats screen. The team on the " +
    "LEFT is `home`; the team on the RIGHT is `away`. Read only what is printed on " +
    "screen — never infer or guess. Use null for any value that is not clearly legible.",
  input_schema: {
    type: "object",
    properties: {
      detected_screen: {
        type: "boolean",
        description:
          "true ONLY if the image is clearly a football video-game end-of-match / " +
          "full-time stats screen. false for anything else (a different screen, a " +
          "real-life photo, a blurry/unreadable image, etc.).",
      },
      confidence: {
        type: "number",
        description: "Overall confidence (0–1) that the reported values are correct.",
      },
      home: SIDE_SCHEMA,
      away: SIDE_SCHEMA,
    },
    required: ["detected_screen", "confidence", "home", "away"],
    additionalProperties: false,
  },
};

// Vision-capable Claude model. Override per environment with ANTHROPIC_MODEL.
// NOTE: confirm this is the current vision model id for your account before deploy.
export const DEFAULT_MODEL = "claude-sonnet-4-5";

export const ANTHROPIC_VERSION = "2023-06-01";
