# OfficeFC

Expo + Firebase app for office EA Sports FC leagues: ELO ratings, confirmed match tracking, finals brackets.

- Feature work happens on `development`; `main` is deploy-only (PRs squash development → main).
- Mobile app lives in `mobile/` (Expo SDK 56, expo-router), trusted writes in `functions/` (Firebase Functions v2, Node 20).
- Full check suite: `npm run check` (format, lint, mobile typecheck, web build, functions tests, root tests, rules tests).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
