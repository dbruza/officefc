# Extraction eval

Measures how well the AI reads end-of-match stats screens — the riskiest part of
AI-assisted logging. **Goals accuracy is the headline metric** (it's what moves ELO);
stat fields are secondary.

```bash
npm run eval                                    # MOCK mode — no network, exercises the harness
ANTHROPIC_API_KEY=sk-ant-… npm run eval -- --real  # REAL mode — scores Claude against labels
node eval/run-eval.mjs --real --model claude-sonnet-4-5  # custom model
node eval/run-eval.mjs --real --output results.csv       # CSV output for tracking
node eval/validate-labels.mjs                             # check labels before running
```

In REAL mode you can also set `ANTHROPIC_BASE_URL`.

## Eval gate (M4 release requirement)

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
