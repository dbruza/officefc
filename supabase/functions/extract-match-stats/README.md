# `extract-match-stats` Edge Function

AI-assisted match logging for OfficeFC. Takes a photo of an end-of-match stats
screen and returns a normalized, human-reviewable suggestion (score + key stats).

**It never submits or confirms a match.** It only pre-fills the log form; opponent
confirmation remains the source of truth (a photo can be faked).

## How it works

```
photo ──▶ Storage (private bucket)
app  ──▶ POST /functions/v1/extract-match-stats   { photoPath }   (+ user JWT)
            │
            ├─ auth: verify signed-in league member (RLS via the user's JWT)
            ├─ download the image (RLS governs access)
            ├─ Claude vision + forced tool use ─▶ structured JSON
            └─ normalize + guardrails (core/validate.mjs)
app  ◀── { ok, detectedScreen, confidence, requiresReview, flags, suggestion }
```

`suggestion` is `{ home, away, homeResult }` where `home` = the LEFT team on screen
and `away` = the RIGHT team. The photo can't identify players, so the app still has
the user pick the opponent and tap which side was theirs.

## Request

```jsonc
// either a private-bucket path…
{ "photoPath": "league-1/2026/m123.jpg", "bucket": "match-photos" }
// …or an inline image (handy for tests)
{ "imageBase64": "<base64>", "mediaType": "image/jpeg" }
```

## Response

```jsonc
{
  "ok": true,
  "detectedScreen": true,
  "confidence": 0.82,
  "requiresReview": false,
  "flags": [],
  "suggestion": {
    "home": { "team_name": "Riverside FC", "goals": 3, "possession": 58, "shots": 14, "shots_on_target": 7 },
    "away": { "team_name": "Harbour Athletic", "goals": 1, "possession": 42, "shots": 8, "shots_on_target": 4 },
    "homeResult": "W"
  }
}
```

`requiresReview` is `true` whenever a score was unreadable, confidence is below the
floor (0.6), or any sanity flag fired (e.g. `possession_sum_off`, `home_sot_gt_shots`).
If the image isn't a stats screen, `ok` is `false` with `reason: "not_a_stats_screen"`
and the app falls straight back to manual entry.

## Deploy

```bash
supabase functions deploy extract-match-stats
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# optional:
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-5
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically. Confirm
`ANTHROPIC_MODEL` is a current vision-capable model id for your account.

## Notes

- **Rate-limit** this function per user (cost control) — e.g. a Postgres counter keyed
  on `auth.uid()` checked at the top of the handler.
- The shared logic in `core/*.mjs` is plain ESM with **no dependencies**, so it runs
  unchanged in Deno here and under Node in `/test` and `/eval`.
