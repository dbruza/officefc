# Extraction eval

Measures how well the AI reads end-of-match stats screens — the riskiest part of
AI-assisted logging. **Goals accuracy is the headline metric** (it's what moves ELO);
stat fields are secondary.

```bash
npm run eval                          # MOCK mode — no network, exercises the harness
ANTHROPIC_API_KEY=sk-ant-… npm run eval   # REAL mode — scores Claude against the labels
```

In REAL mode you can also set `ANTHROPIC_MODEL` (and `ANTHROPIC_BASE_URL`).

## Add cases (do this with REAL photos)

The committed `full-time-sample-01.png` is **synthetic** — only enough to wire up the
harness. A meaningful number needs real images:

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

Aim for variety: different FC/FIFA versions and consoles, clean screenshots vs. glare-y
photos of a TV, draws, big scores, and a few **non**-stats images (set
`"detected_screen": false`) to confirm the model rejects them.

## Regenerate the synthetic fixture

```bash
npm i -D sharp
node eval/sample/generate.mjs
```
