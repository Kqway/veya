# Veya Development Progress

## Current Phase
3

**Status: Phase 3 complete on 2026-09-30.** Persistent create/invite/join flow,
quality gates and independent review passed. This run publishes the commit
`phase-3: intent and invite flow` to GitHub main and stops before Phase 4.

## Completed Phases
- **Phase 1 — foundation** (`5766774`): responsive Next.js landing, strict
  TypeScript, Tailwind, environment/service boundaries, tests and CI.
- **Phase 2 — database and backend** (`aeb73e0`): nine domain tables, checked
  migrations, transactions, guest sessions, authorized APIs, seed and DB CLI.
- **Phase 3 — intent and invite flow:** persistent creation, shareable invites,
  guest participation, mobile seven-day picker, custom times, budgets/preferences,
  returning-guest editing, explicit error/closed states and opt-in entry analytics.

## Current Architecture
- Next.js 16.3.8, React 19.3, strict TypeScript including unchecked-index and exact
  optional-property checks, Tailwind CSS 4. Node 24 LTS recommended (22.12 minimum).
- `src/app`: landing/shell, `/i/[slug]`, generic metadata/noindex on invite pages,
  error/404 UI and Node JSON API routes. Pages render on demand for runtime config.
- `src/features/intents`: idea validation/examples/composer; second step uses
  `CreateDetails` to create a real guest/intent and navigate to its saved invite.
- `src/features/entry`: browser API with cookie transport and 15-second timeout;
  exact currency conversion via BigInt; local time/DST validation; focused creation,
  sharing, availability, participation and invite state components.
- Invite screen loads no-store public/own projections. Share panel supports copy,
  selectable manual URL, Telegram and Web Share when available. Participant form
  POSTs new membership and PUTs existing caller data without replacing identity.
- `src/features/backend`: strict schemas, transactional service/repository, hashed
  sessions, creator authorization, public/own projections and bounded HTTP.
- `src/lib/db` and `db/migrations`: lazy bounded pg pool, pinned transactions,
  checksummed/advisory-locked migrations, nine tables and private RLS boundaries.
  Server connection owns tables or has BYPASSRLS; no direct-client RLS policies.
- `scripts`: persistent loopback/SCRAM native development PostgreSQL, migrate/seed
  CLI. Embedded binaries are dev/test only, `.local/postgres` is ignored.
- `src/lib/analytics`: disabled by default; React provider passes only enablement;
  four bounded browser events plus intent_created/participant_joined server events.
  SQL stores event name, enumerated surface and timestamp only.
- AI remains a deterministic mock contract; scheduling contains domain types only.
  Algorithms/results/voting routes and remote AI belong to later phases.
- Vitest/Testing Library plus isolated native PostgreSQL tests; Playwright creates
  its own ephemeral PostgreSQL and production Next server with a matching origin.
  Desktop/mobile projects use Europe/Moscow to exercise local-to-UTC conversion.

## Important Decisions
- User authorized GitHub publication and continuation. Phase 1–2 were fast-forward
  pushed to main; Phase 3 uses the supplied work branch and one final phase commit.
  Do not force-push, deploy a site or start Phase 4 in this execution.
- Guest identity is an HttpOnly/SameSite=Lax cookie, Secure in production, valid
  30 days; only hashes are stored. High-entropy public slugs are invitation links.
- Mutations require configured Origin. JSON bodies are capped at 16 KiB. Client
  identifiers and private data from other participants are never accepted/exposed.
- Collect creator name, lifetime 3/7/14 days and optional activity/place details.
  Budgets and availability are collected per participant. Creator can join too.
- Seven local days: Morning 09–12, Afternoon 12–17, Evening 17–22; custom same-day
  ranges. Only future windows before expiry may be added; require one for UI entry.
  Save UTC ISO instants, reject nonexistent DST times and overlaps, allow adjacency.
- Currency fraction digits determine minor units; zero remains a real budget.
  Preserve saved minimum budgets, unmodified preference values and all valid stored
  windows when editing, including those beyond the current picker horizon.
- Duplicate joins preserve one membership; existing guest edits never call session
  creation. Revoked credentials show a reload message and preserve form input.
- Pages render on demand instead of freezing analytics enablement during build.
  This costs a server page render and ensures runtime configuration is effective.
- User autonomy overrides skill approval pauses; implemented inline with one fresh
  independent reviewer. No Critical/Important findings; two Minor follow-ups below.

## Known Issues
- No blocking Phase 3 failures. Scheduling/results/voting, AI, rich sharing metadata,
  rate limiting, retention and release audit remain later phases; not release-ready.
- **Review follow-up:** an unmodified comma-containing saved preference is preserved,
  but editing that category's comma-separated text can split the existing value.
  Prefer unambiguous token controls before relying on detailed preference scoring.
  See `src/features/entry/form-values.ts`.
- **Review follow-up:** saved overnight/24-hour ranges show only the start date;
  end time without its date can be ambiguous, including after changing timezone.
  Include the end date when local dates differ in AvailabilityPicker.formatWindow.
- External hosted PostgreSQL/Supabase and production deployment were not tested.
  Actual native PostgreSQL and production browser flows passed without an account.
- Remote CI results have not been verified; equivalent quality commands pass locally.
- Cookie removal/revocation loses access as that guest; account recovery is absent
  by design. Seed guest bearer tokens are unrecoverable and demo expires in 30 days.
- Native Web Share was tested through capability/failure handling and reviewed;
  actual device share-sheet integration has not been manually exercised.

## Tests Status
Verified on the implementation and browser flow:

- `npm run check` — passed: lint with zero warnings, generated Next route types,
  strict TypeScript, full test suite and production build.
- `npm test` — final **78 tests in 12 files** passed, including additional native
  sharing success/cancellation/failure DOM coverage; lint/types rechecked afterward.
- Native PostgreSQL integration subset — **44 tests**: original schema/service/
  HTTP/seed coverage plus opt-in analytics validation/privacy and safe failures.
- New unit/DOM checks cover exact money/currency precision, DST/date conversion,
  future/expiry/overlap validation, saved values, cookie API errors, creation
  failure input preservation, direct HTTP join projection, revoked edits and copy
  fallback. Backend regressions remain green.
- `npm run test:e2e` — **18 passed**, desktop/mobile with real isolated PostgreSQL:
  create/share/separate guest join/refresh/edit, duplicate membership/privacy,
  revoked edit, invalid/expired invite, long persisted ideas, custom Moscow-to-UTC
  times, overlap rejection, bounded analytics, keyboard/error states and 404 return.
- Joined desktop/mobile screenshots inspected: consistent styling and no overflow.
- `npm audit --json` — **0 reported vulnerabilities**; no dependencies added.
- `git diff --check` — passed; no credentials, local database files or debug outputs
  included. Verification servers stopped and ephemeral DBs cleaned automatically.
- Independent whole-change review — no Critical/Important findings; two Minor
  follow-ups recorded above. The reviewer did not rerun browsers or assess devices.

Observed regressions before fixes: comma-containing unchanged preferences split;
new-join UI incorrectly unwrapped the HTTP response and stayed loading; static
layout froze analytics disabled despite runtime enablement. Regression tests
failed first, then all applicable gates passed. No current test failures.

## Next Phase
**Phase 4 — deterministic scheduling and group decisions.** Isolate a pure engine
from UI, SQL and AI; rank maximum/partial overlap using availability quality,
preferences and compatible budgets. Return best match plus 2–3 alternatives and
useful compromises instead of only no matches. Persist PlanSuggestion, add a
result page, availability summary, YES/MAYBE/NO voting and appropriate recalculation.
Track result_viewed/vote_submitted. Cover full/partial/no overlap, one participant,
multiple windows, budget conflicts, preferences and timezone/date edge cases.
Do not begin the optional Phase 5 AI layer in that execution.

## Notes for Next Codex Run
- Read README/progress/actual code/history. Confirm this Phase 3 commit and GitHub
  main state; do not repeat completed foundation, backend or entry flows.
- Run npm ci and npm run check. Build before npm run test:e2e; browser tests own
  their temporary database and require port 3100 free. Never use a production DB.
- For manual development: npm run db:local, set the documented local DATABASE_URL
  in .env.local, then db:migrate and optionally db:seed. Match NEXT_PUBLIC_APP_URL
  to the browser origin. Keep secrets server-only and do not edit applied migrations.
- Review the two recorded edge follow-ups before wiring preference scoring and
  availability summaries. Minor fixes may be Phase 4 prerequisites, not a restart.
- POST /api/session reuses an active guest. Join HTTP returns IntentView directly
  (201 new, 200 duplicate); service join returns {created,view}. Do not confuse them.
- Creator is not automatically a Participant. They add availability through the
  same form; the engine must handle zero participants, one guest and missing fields
  in backend-created entries even though the UI requires a time window.
- Participant PUT replaces all fields. Preserve minor-unit budgets and existing
  values; membership changes already invalidate suggestions/votes and ready state.
- Analytics browser endpoint allows only four Phase 3 pairs. Add result/vote events
  intentionally and safely in Phase 4; never expose private participant identities.
- GitHub publication is authorized. Complete exactly Phase 4, update this record,
  create `phase-4: scheduling engine`, fast-forward publish as appropriate and stop.
