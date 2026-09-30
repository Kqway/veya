# Veya Development Progress

## Current Phase
4

**Status: Phase 4 complete and verified on 2026-09-30.**
Exactly one phase in this run. Phase 5 has not started.

## Completed Phases
- **Phase 1 — foundation** (`5766774`): responsive Next.js landing, strict
  TypeScript, Tailwind, configuration/service boundaries, tests and CI.
- **Phase 2 — database and backend** (`aeb73e0`): nine domain tables, checked
  migrations, transactions, guest sessions, authorized APIs, seed and DB CLI.
- **Phase 3 — intent and invite flow** (`3544ab4`): persistent creation, sharing,
  no-account participation, local availability/custom times, budgets/preferences,
  returning-guest editing, explicit errors/closed states and opt-in entry analytics.
- **Phase 4 — scheduling engine** (this phase commit): pure overlap/ranking,
  shorter/subgroup compromises and alternatives, persistent results, safe attendance
  summaries, YES/MAYBE/NO voting, creator confirmation and recalculation.

## Current Architecture
- Next.js 16.3.8, React 19.3, strict TypeScript with unchecked-index and exact
  optional-property checks, Tailwind 4. Node 24 LTS recommended (22.12 minimum).
- `src/app`: landing, `/i/[slug]`, `/i/[slug]/results`, generic noindex invite/result
  metadata, error/404 UI and Node JSON APIs. Pages read runtime configuration.
- `src/features/intents`: validated idea composer and persistent creation details.
- `src/features/entry`: cookie browser API with a 15-second timeout; exact BigInt
  currency conversion, local time/DST validation, sharing and participation forms.
  Saved windows/preferences/minimum budgets survive editing; quoted CSV preserves
  commas/quotes within preference values; overnight summaries include the end date.
- `src/features/scheduling/engine.ts`: pure explicit-input UTC `suggest`, separate
  from clock, UI, SQL and AI. Merges windows, evaluates target/grid/boundary spans,
  ranks full attendance first, then quality, preference similarity and budgets.
- `src/features/scheduling/components`: proposal cards and results screen, local
  timezone, aggregate votes, own pressed vote, group-only attendance, explicit
  confirmation, refresh, stale reload and empty/error/closed states.
- `src/features/backend`: strict schemas, hashed guest sessions, intent-lock
  transactions, safe public/own/member projections and bounded same-origin HTTP.
  Results repository caches proposals by input/output fingerprint; ResultsService
  authorizes votes and creator decisions with public proposal key and revision.
- `src/lib/db` and `db/migrations`: lazy bounded pg pool, pinned transactions,
  checked/advisory-locked migrations, nine tables, server-only RLS. Migration 0003
  adds public proposal keys, revision/fingerprint and same-intent selection FK.
  Server owns tables or has BYPASSRLS; there are no direct-client RLS policies.
- `scripts`: persistent loopback/SCRAM native development PostgreSQL, migrate/seed
  CLI. Embedded binaries are dev/test only; `.local/postgres` is ignored.
- `src/lib/analytics`: disabled by default. Five bounded browser events (including
  result_viewed) and three server mutation events (including changed vote_submitted).
  Only names, enumerated surfaces and timestamps are stored, never personal data.
- AI remains the original mock contract. No remote AI or structured AI tasks yet.
- Vitest/Testing Library plus isolated native PostgreSQL tests; Playwright owns an
  ephemeral PostgreSQL and production Next server. Desktop/mobile use Moscow time.

## Important Decisions
- User authorized continued development and GitHub publication. Use the supplied
  work branch, one prescribed phase commit and fast-forward push to main. Never
  force-push; no deployment/PR is part of this run. Stop after Phase 4.
- Guest identity is a 30-day HttpOnly/SameSite=Lax cookie, Secure in production;
  only SHA-256 hashes persist. High-entropy slugs act as invitation links.
- Mutations require configured Origin and application/json bodies up to 16 KiB.
  Clients never supply guest/participant/internal proposal IDs. Public proposals
  use independent opaque 32-hex keys and a safe integer scheduling revision.
- Creator is not automatically a Participant. They can join the same form. Only
  current members vote; only the active creator confirms. One vote per proposal
  and person is upserted; repeated identical votes do not duplicate analytics.
- Service targets 60-minute meetups before expiry, within 30 days. Engine supports
  explicit other durations. Normally shortened spans reach at least 15 minutes;
  if no such option exists, even a shorter real window is offered. Full coverage
  counts first; partial attendance is reported separately. Greedy distinct
  non-overlapping alternatives number up to three, fewer if availability is limited.
- Secondary score: attendance 700, quality 150, preference overlap 100 and budget
  compatibility 50. Unknown budgets are not zero; mixed currencies are not compared.
  Similar food preferences do not establish allergy safety or venue suitability.
- Private preference text only affects ranking. Public activity labels come only
  from already-public structured intent activities. Numerical budgets stay private.
- Anonymous/outsider results show counts and aggregate votes. Valid members and
  creator additionally see display names and derived attendance per proposal,
  never other people's exact windows, notes, budgets, preferences or identities.
  Entry form explains this visibility. Own membership retains its private fields.
- Results GET lazily derives stored proposals under an intent write lock. Fingerprint
  engine version, stable inputs and output, excluding the incremented revision.
  Unchanged results preserve proposal keys/votes. Membership or elapsed proposals
  regenerate the set and clear votes atomically; stale submissions get 409 and reload.
- Confirmation has a separate explicit UI step. A decided plan freezes its saved
  selection and closes joining/editing/voting. The collection deadline or creator
  close cannot erase it; repeating the same selection is idempotent. The UI treats
  a saved selected key as authoritative, including previously expired snapshots.
- User autonomy overrides skill approval pauses. Inline execution used one fresh
  independent whole-change reviewer and one necessary regression-tested fix pass.

## Known Issues
- No blocking Phase 4 failures. AI, rich previews/mobile polish, rate limiting,
  retention and release audit remain Phases 5–7; this is not a release candidate.
- The two Phase 3 Minor follow-ups are fixed: quoted preference edits preserve
  comma-containing saved values, and overnight/24-hour summaries show end dates.
- No hosted PostgreSQL/Supabase account or production deployment was tested. Actual
  native PostgreSQL and local production-browser flows run without external accounts.
- Remote CI results are not verified; equivalent quality commands pass locally.
- Clearing/revoking a cookie loses that guest's access; account recovery is absent.
  Seed guest tokens are unrecoverable, and the demo expires after 30 days.
- Actual device Web Share sheets have not been manually exercised; browser
  capability/cancellation/failure behavior is covered. Browser projects use Chromium.
- Search enumerates boundary spans; production scale/load limits are Phase 7 work.
  Refresh results is explicit; there is no live synchronization or background scheduler.

## Tests Status
- `npm run check` after review fixes — passed: lint zero warnings, generated route
  types, strict TypeScript, **115 tests in 16 files**, and production build.
- Native PostgreSQL coverage totals **59 tests**, including **14 results tests**:
  stable cache/keys/votes, anonymous/member privacy, private activity labels, changed
  votes/analytics, disabled tracking, forged/cross-group inputs, expired/revoked
  sessions, stale regeneration, elapsed proposals, concurrent reads/votes, creator
  freeze including deadline/close, useful empty state and transactional rollback.
- Engine **15 tests** cover full/partial/disjoint/zero/past/single/multiple windows,
  short periods including fragmented boundaries, preference scoring/private labels,
  incompatible/mixed budgets, exact offsets/DST, determinism and validation.
- Results DOM **5 tests** cover saved voting, stale reload, explicit confirmation,
  useful empty state and confirmed alternative after expired collection status.
- `npm run test:e2e` after review fixes — **22/22 passed**, desktop/mobile with
  real isolated PostgreSQL and production Next. Phase 4 covers anonymous privacy, overlap, separate
  guest voting/refresh, changed availability/stale rejection, confirm/closed flow,
  empty/invalid/expired results and bounded analytics. All 18 earlier scenarios
  passed alongside the four new cases. Servers stopped and ephemeral DBs cleaned.
- Results/confirmation desktop/mobile screenshots inspected; no horizontal overflow.
- `npm audit --json` — **0 reported vulnerabilities**, no dependencies added.
- `git diff --check` and credential-pattern inspection pass. Only configuration
  key names matched; no credentials, DB files or debug artifacts are included.
- Independent review found **three Important**, no Critical/Minor. All reproduced
  RED, then fixed in one pass; engine/native/DOM regression subset **34/34 GREEN**.
  Findings: private preference promoted to public label; unrelated boundaries hid
  a shared short period; expiry hid a confirmed alternative. No re-review performed.
  No additional vote ownership, atomicity or locking defects reported.

## Next Phase
**Phase 5 — optional AI enhancements.** Support AI_PROVIDER=mock (working local
by default) and AI_PROVIDER=openai with server-only keys. Add structured tasks for
free-form intent parsing (type/date/activity/location/budget hints), human-friendly
plan suggestions and explanations. Validate JSON, enforce timeouts/token limits,
and fall back safely for missing keys, unavailable/malformed/timed-out responses.
Keep deterministic scheduling and the full create/join/vote/decide flow usable
without AI. Add provider/task/fallback tests. Do not begin Phase 6 in that run.

## Notes for Next Codex Run
- Read README/progress/code/history; confirm this phase commit and GitHub main.
  Do not redo completed Phases 1–4. Start exactly Phase 5, one commit and stop.
- Run npm ci and npm run check. Build before test:e2e; tests own their temporary
  database and port 3100. Never use/reset development or production DATABASE_URL.
- Manual development: npm run db:local, set the documented local DATABASE_URL in
  .env.local, db:migrate and optionally db:seed. Match NEXT_PUBLIC_APP_URL to the
  browser origin. Keep secrets server-only; add migrations rather than edit applied SQL.
- POST session reuses an active guest. Join HTTP returns IntentView directly;
  service join returns {created,view}. Participant PUT is full replacement; preserve
  saved private fields. Creator confirmation must not invent a membership.
- Phase 5 may enrich explanations or parse intent but must not let model output
  alter deterministic attendance, expose private preferences/notes/budgets, or bypass
  proposal revision, membership, creator authorization and closed-state checks.
- Preserve the fingerprint/version/revision distinction. A material deterministic
  engine change requires a version bump; closed decisions never regenerate.
- Analytics allows five browser event/surface pairs. vote_submitted is server-only;
  do not send model text, identity, API keys or personal fields as properties.
- Publication remains authorized: complete Phase 5, update this record, create
  `phase-5: AI integration`, fast-forward publish appropriately and stop.
