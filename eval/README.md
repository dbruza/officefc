# Extraction eval

Measures how well the AI reads end-of-match stats screens — the riskiest part of
AI-assisted logging. **Goals accuracy is the headline metric** (it's what moves ELO);
stat fields are secondary.

```bash
npm run eval                                    # MOCK mode — no network, exercises the harness
OPENROUTER_API_KEY=sk-or-… npm run eval -- --real  # REAL mode — scores the model against labels
node eval/run-eval.mjs --real --model meta/muse-spark-1.3  # score another OpenRouter model
node eval/run-eval.mjs --real --output results.csv       # CSV output for tracking
node eval/validate-labels.mjs                             # check labels before running
```

In REAL mode you can also set `OPENROUTER_BASE_URL`, or `EXTRACTION_MODEL` instead of `--model`.
REAL mode uses your own OpenRouter key from the shell environment and is billed to it; it
never reads your deployment's `OPENROUTER_API_KEY` secret.

The harness runs the same extraction core as the `extractMatchStats` Cloud Function
(`functions/src/extract/core`), and defaults to the same model (`DEFAULT_MODEL` in
`schema.mjs`). If you change the model for your deployment, score it here first, and update
the app copy that names the model: the privacy policy (`mobile/src/lib/legal.ts`), the AI
consent step (`mobile/src/components/SnapFlow/steps.tsx`), and the AI setting in
`mobile/app/(app)/settings.tsx`.

The repository ships only a couple of sample images. Add your own photos of your league's
screens to measure accuracy in your setting; keep players' personal data out of anything you
commit.

## Eval gate

Before relying on AI photo reading (`AI_FEATURES=true`), or after changing the prompt,
schema, or model, aim for:

- At least **20** readable FIFA/FC stats-screen images (clean screenshots, glare-y TV photos, draws, big scores, different layouts)
- At least **5** non-stats/unreadable images (set `"detected_screen": false`)
- ≥ 90% exact two-sided goals accuracy on readable images
- Per-field accuracy breakdown for possession, shots, shots-on-target

## Add cases

1. Drop a screenshot/photo in `eval/images/` (png/jpg/webp).
2. Add `eval/labels/<name>.json` with the ground truth:

```jsonc
{
  "image": "<name>.png",
  "expected": {
    "detected_screen": true,
    "home": { "team_name": "…", "goals": 2, "possession": 51, "shots": 9,  "shots_on_target": 5 },
    "away": { "team_name": "…", "goals": 2, "possession": 49, "shots": 12, "shots_on_target": 6 }
  }
}
```

For non-stats images:

```jsonc
{
  "image": "menu-screen.png",
  "expected": { "detected_screen": false }
}
```

3. Run `node eval/validate-labels.mjs` to catch malformed labels before scoring.
4. Run the harness to measure accuracy.

Aim for variety: different FC/FIFA versions (FIFA 23, FC 24, FC 25) and consoles, clean screenshots vs. glare-y photos of a TV, draws, big scores.

## Regenerate the synthetic fixture

```bash
npm i -D sharp
node eval/sample/generate.mjs
```
