# Veya Development Progress

## Current Phase
5

**Status: Phase 5 complete on 2026-09-30.**
Structured AI tasks, optional reviewed/transient UI and review fixes are verified.
All quality gates pass; this record belongs to the prescribed Phase 5 commit.

## Completed Phases
- **Phase 1 — foundation** (`5766774`): responsive Next.js landing, strict
  TypeScript, Tailwind, configuration/service boundaries, tests and CI.
- **Phase 2 — database and backend** (`aeb73e0`): nine domain tables, checked
  migrations, transactions, guest sessions, authorized APIs, seed and DB CLI.
- **Phase 3 — intent and invite flow** (`3544ab4`): persistent creation, sharing,
  no-account participation, local availability/custom times, budgets/preferences,
  returning-guest editing, explicit errors/closed states and opt-in entry analytics.
- **Phase 4 — scheduling engine** (`f969f52`): pure overlap/ranking,
  shorter/subgroup compromises and alternatives, persistent results, safe attendance
  summaries, YES/MAYBE/NO voting, creator confirmation and recalculation.
- **Phase 5 — AI layer** (`phase-5: AI integration`): structured intent parsing,
  explicit preview/apply, public advisory hints, optional meetup ideas and grounded
  explanations, server-only mock/OpenAI providers and validated bounded fallback.

## Current Architecture
- Next.js 16.3.8, React 19.3, strict TypeScript with unchecked-index and exact
  optional-property checks, Tailwind 4. Node 24 LTS recommended (22.12 minimum).
- `src/app`: landing, `/i/[slug]`, `/i/[slug]/results`, generic noindex invite/result
  metadata, error/404 UI and Node JSON APIs. Pages read runtime configuration.
- `src/features/intents`: validated idea composer and shared structured intent
  schema. Existing JSON accepts optional dateHint/budgetHint without a migration.
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
- `src/lib/ai`: typed parseIntent/suggestPlan/explainPlan tasks, strict Zod schemas,
  deterministic mock vocabulary/templates and native-fetch OpenAI adapter. Output
  validation, semantic explanation guards, eight-second deadline and local fallback.
- AI HTTP: stateless POST /api/ai/intent and authorized POST slug/assist. Public
  projection only, parallel generation outside transactions, completion revalidation.
  Entry preview requires Apply; results assistance is transient and revision-keyed.
- Vitest/Testing Library plus isolated native PostgreSQL tests; Playwright owns an
  ephemeral PostgreSQL and production Next server. Desktop/mobile use Moscow time.

## Important Decisions
- User authorized continued development and GitHub publication. Use the supplied
  work branch, one prescribed phase commit and fast-forward push to main. Never
  force-push; no deployment/PR is part of this run. Stop after Phase 5.
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
- AI is optional and runs only after a click. Parsing sends the idea, explicit
  local reference date and IANA timezone; Apply changes editable type/activity/place
  and public hints. Date/budget hints are advisory, never scheduling constraints,
  expiry dates or participant numerical budgets. Manual creation stays available.
- Mock uses narrow English/Russian words, literal hints and real ISO dates; it is
  not an LLM. Whole Unicode date words prevent substring errors; day after tomorrow
  is explicit. This week means today through Sunday of a Monday–Sunday calendar
  week. Arithmetic beyond four-digit ISO dates returns an unknown hint.
- Assistance requires the active creator or current membership and current key/
  revision, rechecked after generation. Prompts include only public intent fields
  and aggregate proposal facts, never private records, names, IDs or votes.
  Creative text renders in a separate plain-text panel; factual explanation uses
  validated applicable reason codes and server-owned phrases. AI never writes
  proposals/votes/decisions. Revision/key changes reset the panel; votes retain it.
- OpenAI uses fixed chat/completions, gpt-4.1-mini default, strict JSON schema,
  max_completion_tokens=1000, store=false, 64 KiB envelope and an overall 8000ms
  race/abort deadline including stalled reads. No redirects, retries or raw provider
  logging. Missing key, HTTP/network/refusal/truncated/malformed/timeout errors use
  local fallback; invalid user input is rejected. Keys remain server-only.
- User autonomy overrides skill approval pauses and integration menus; publication
  was already authorized. Inline execution used one fresh independent whole-change
  reviewer and one necessary regression-tested fix pass. No re-review performed.

## Known Issues
- No blocking Phase 5 failures. Mobile/viral polish, rate limiting, retention,
  production cost/load controls and release audit remain Phases 6–7.
- Live OpenAI access was not verified: no configured API key and this environment's
  network policy does not allow api.openai.com. Mock works without credentials;
  injected transport tests verify remote requests, validation, failure and fallback.
  A production host needs allowed egress and a strict-JSON-compatible model.
- The mock has a small explicit vocabulary; unfamiliar intent details stay unknown.
  Date/budget hints do not constrain scheduling. There are no autonomous agents,
  background AI calls or live synchronization; results refresh remains explicit.
- No hosted PostgreSQL/Supabase or production deployment was tested. Actual native
  PostgreSQL and local production-browser flows work without external accounts.
- Remote CI results are not verified; equivalent quality commands pass locally.
- Clearing/revoking a cookie loses that guest's access; account recovery is absent.
  Seed guest tokens are unrecoverable, and the demo expires after 30 days.
- Actual device Web Share sheets have not been manually exercised; browser
  capability/cancellation/failure behavior is covered. Projects use Chromium.
- Boundary span enumeration needs production scale/load limits in Phase 7.

## Tests Status
- Final `npm run check` after review fixes — passed: zero-warning lint, generated
  route types, strict TypeScript, **166 tests in 20 files**, production build.
- Native PostgreSQL coverage totals **68 tests**, including **9 AI integration
  tests**: stateless parsing, origin/body/schema, legacy intent/hint persistence,
  active creator/member authorization, private projection, key/revision checks,
  vote preservation, lock release during generation, stale/revoked completion,
  fallback, and decided/expired saved-plan assistance without reopening writes.
- AI/task/provider/env subset **51/51 passed**: deterministic parsing and date
  boundaries, unknown input, missing-key/no-network operation, strict output and
  semantic reason validation, request/schema/token/store/redirect bounds, refusal/
  truncation/malformed/HTTP/network failure, oversized response, ignored abort and
  stalled response-body deadlines. Provider failures never expose raw error text.
- New AI DOM **6/6 passed**, alongside prior form/results tests: explicit review/
  apply and dismiss, preserved manual fields, failure and slow manual creation,
  safe plain-text ideas, exact selection-only requests and stale retry.
- New desktop/mobile AI browser subset **4/4 passed**: parse-review-apply-create,
  public hint persistence, assist-vote-refresh-confirm, archived assistance and
  manual creation after parsing failure. Screenshot layout inspected; no overflow.
- Final complete `npm run test:e2e` — **26/26 passed**, desktop/mobile Chromium
  with native isolated PostgreSQL and production Next; earlier entry, analytics,
  privacy, scheduling and confirmation regressions pass. Owned test server/database
  stopped and cleaned.
- `npm audit --json` — **0 vulnerabilities**, no dependencies added.
- Fresh whole-change review: **no Critical, two Important and one Minor**. Both
  incorrect mock dates and extended-year fallback reproduced (six RED cases),
  then fixed together with seven regression tests. No deferred findings. Reviewer
  found no authorization, prompt privacy, lock, lifecycle or model mutation issue.
- Staged whitespace, credential-pattern and artifact inspection passed; only
  configuration names and synthetic fixtures, no secrets or runtime artifacts.

## Next Phase
**Phase 6 — product quality + virality.** Improve mobile landing/create/invite/
availability/results/share flows, hierarchy, spacing, loading/motion and empty/
error states. Polish Web Share, Telegram and copy link; add privacy-conscious
Open Graph invite previews. Improve post-join/post-vote prompts to create another
plan and track bounded new_intent_from_invite. Review and reduce friction across
create → share → join → result → create again. Do not begin Phase 7 in that run.

## Notes for Next Codex Run
- Read README/progress/code/history; verify this phase commit and GitHub main.
  Do not redo Phases 1–5. Start exactly Phase 6, one prescribed commit and stop.
- Run npm ci and npm run check. Build before test:e2e; tests own their temporary
  database and port 3100. Never use/reset development or production DATABASE_URL.
  Browser server forces AI_PROVIDER=mock and an empty key; do not enable live calls.
- Manual development: npm run db:local, documented local DATABASE_URL in .env.local,
  db:migrate and optional db:seed. Match NEXT_PUBLIC_APP_URL to browser origin.
  Keep keys server-only; add migrations instead of editing applied SQL.
- POST session reuses an active guest. Join HTTP returns IntentView directly;
  service join returns {created,view}. Participant PUT is full replacement; preserve
  saved private fields. Creator confirmation must not invent a membership.
- Preserve deterministic scheduler and fingerprint/version/revision distinction.
  Material engine changes require a version bump; closed decisions never regenerate.
  Private preferences affect ranking, never public activity labels or AI prompts.
- AI helpers stay explicit and optional. Preserve preview/apply and all manual
  paths, minimal public projection, no transactions over generation, completion
  access/revision checks, reason grounding and key/revision remount behavior.
- Rich previews must not expose membership names, windows, notes, budgets or IDs.
  Invite/result currently use generic noindex metadata; balance useful previews with
  bearer-link privacy and existing authorization boundaries.
- Analytics currently has five browser event/surface pairs and three server events.
  Add the Phase 6 event with bounded enums; never send personal/model text or keys.
- Publication remains authorized: finish Phase 6, update this record, commit
  `phase-6: viral UX and polish`, fast-forward push to main and stop.
