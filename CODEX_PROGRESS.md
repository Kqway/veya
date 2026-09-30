# Veya Development Progress

## Current Phase
2

**Status: Phase 2 complete on 2026-09-30.** Backend, native PostgreSQL integration,
production HTTP smoke checks, browser regressions and independent review passed.
This execution stops after the commit `phase-2: backend and data model`.

## Completed Phases
- **Phase 1 — foundation** (`5766774`): responsive Next.js landing, validated local
  draft preview, strict TypeScript, Tailwind, environment/service boundaries,
  scheduling contract, tests, CI and setup documentation.
- **Phase 2 — database and backend:** nine domain tables, checked migrations,
  atomic transactions, guest sessions, authorization, strict validation, safe
  JSON APIs, optional database analytics, idempotent demo and local database CLI.

## Current Architecture
- Next.js 16.3.8 App Router, React 19.3, strict TypeScript including
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, Tailwind CSS 4.
  npm lockfile committed; Node 24 LTS recommended (minimum 22.12).
- `src/app`: static landing/shell/metadata/error/404 UI and Node API routes for
  sessions, intents, joining and updating the caller's participation.
- `src/features/intents`: local composer and trimmed 1–500 character draft schema.
  Submission still produces a local preview; Phase 3 connects the persistent API.
- `src/features/backend`: strict schemas, transactional service/repository, hashed
  guest sessions, creator authorization, public/own projections and HTTP boundary.
- `src/lib/db`: lazy bounded pg pool, pinned transactions, checksum/advisory-lock
  migration runner and idempotent seed. SQL values are parameterized.
- `db/migrations`: User, Intent, Participant, AvailabilityWindow, Preference,
  PlanSuggestion, Vote, AnalyticsEvent and GuestParticipantSession tables, indices,
  constraints and RLS without direct-client policies. The trusted server connection
  owns tables or has BYPASSRLS; guest authorization runs in the service.
- `scripts`: native local PostgreSQL with persistent ignored `.local/postgres`,
  migration and seed commands. Embedded binaries are dev/test dependencies only.
- `src/lib/config`: validated public origin and server-only secrets; landing and
  build require no credentials. Backend HTTP requires an explicit DATABASE_URL.
- `src/lib/analytics`: no-op default plus opt-in PostgreSQL name/surface/time events;
  no personal text, session tokens or arbitrary properties.
- `src/lib/ai`: deterministic mock text contract only. Scheduling has domain types
  only; algorithms, voting routes and remote AI belong to later phases.
- Vitest/Testing Library plus isolated native PostgreSQL integration tests;
  Playwright desktop/mobile Chromium checks; GitHub Actions quality workflow.

## Important Decisions
- Complete exactly Phase 2 in this execution; retain the supplied `work` checkout,
  create one phase commit, and do not push or deploy.
- Registration is unnecessary. Guest cookies carry a 256-bit random token for
  30 days; only SHA-256 hashes are stored. Invites use random 144-bit public slugs.
- Cookies are HttpOnly, SameSite=Lax, path `/`, and Secure in production. Mutations
  require the configured Origin; POST/PUT JSON bodies are bounded to 16 KiB.
- Resolve and lock active guest credentials for each write; serialize membership
  changes with intent locks. Duplicate joins preserve existing participant data.
- Public API views omit internal IDs and other participants' private fields.
  Only the authenticated caller receives their own membership details.
- Budgets use nonnegative integer minor units and a supported uppercase currency.
  Availability is validated as future, non-overlapping, bounded offset ISO instants
  and normalized to UTC before SQL insertion.
- Membership changes invalidate stored suggestions/votes and return ready intents
  to collecting. Automatic recomputation is Phase 4.
- Test databases are ephemeral and independent of DATABASE_URL. Local development
  uses loopback/SCRAM; fixed demo credentials are never production credentials.
- The autonomous instruction overrides skill approval pauses. Implementation was
  inline, with an independent review; both minor findings were resolved.

## Known Issues
- No blocking Phase 2 failures or outstanding review findings.
- Landing drafts still disappear on refresh; persistent creation, invite pages and
  join forms are the next phase. Backend APIs already persist data.
- Hosted PostgreSQL/Supabase connectivity was not tested; no external database
  credentials were supplied. Native PostgreSQL and the production HTTP path passed.
- CI has not run remotely; equivalent quality commands passed locally.
- Scheduling/results/voting UI, optional AI, rate limiting, retention and release
  hardening remain scoped to later phases. This is not a release candidate.
- Demo seed expires after 30 days; repeat seeding does not refresh/reset it.
  No demo bearer token is recoverable from the seed.

## Tests Status
Verified on the final implementation:

- `npm run check` — passed: zero-warning lint, generated Next route types and strict
  TypeScript, **62 tests in 7 files**, and production build.
- Native PostgreSQL integration subset — **42 tests** covering migrations/checksums,
  rollback, SQL constraints, RLS, hashed sessions, expiry/revocation/forgery,
  authorization, privacy, concurrent joins, validation, HTTP transport and seed.
- `npm run test:e2e` — **10 passed**, desktop/mobile production-browser regressions.
- `npm audit --json` — **0 reported vulnerabilities**, production and development.
- `git diff --check` — passed.
- Local CLI — migrations applied/repeated safely, seed repeated without duplication,
  PostgreSQL stopped/restarted cleanly, and the same demo survived restart.
- Real production Next.js HTTP requests — session persistence, create/read/join,
  duplicate join, own updates, foreign close rejection, creator close, expired
  invite rejection and revoked-token rejection passed.
- Review regression — offset `+16:00` initially produced 503 despite valid service
  input; UTC normalization now passes native HTTP tests and real production HTTP.
- Independent review — no Critical/Important findings; timezone normalization and
  test-command documentation findings were fixed and reverified.

Meaningful test-first failures were observed before database, service, transport
and seed implementation. Currency validation and timezone compatibility regressions
were reproduced before their fixes. No current test failures.

## Next Phase
**Phase 3 — create + invite + join.** Connect the landing composer to persistent
intent creation. Build `/i/[public_slug]`, useful invite sharing and registration-free
participant entry with availability/preferences/budgets, loading/error states,
mobile layouts and persisted returning-guest behavior. Use the existing authorized
API; do not start the Phase 4 scheduling algorithm or voting flow in that run.

## Notes for Next Codex Run
- Read README, this file, actual code and git history first. Confirm the Phase 2
  commit; do not rebuild completed schema/service work or repeat Phase 1 UI work.
- Run `npm ci` and `npm run check`. Browser checks need `npm run build` followed by
  `npm run test:e2e`; Chromium setup is documented in README.
- Start `npm run db:local`, set the documented local DATABASE_URL in `.env.local`,
  then run `npm run db:migrate` and optionally `npm run db:seed`. HTTP also needs
  NEXT_PUBLIC_APP_URL to match the browser origin. Application does not default DB.
- Local data persists in ignored `.local/postgres`; verification servers are stopped
  at handoff. No external account or database is required for development/tests.
- Create/reuse a guest through POST `/api/session` before authenticated writes.
  Keep cookie transport; never expose guest tokens or trust client-supplied IDs.
- Respect minor-unit budgets, full-replacement participant PUT semantics, offset
  instants and public/own projections. Seed suggestions are demo data, not an engine.
- Preserve server-only boundaries and safe errors. Add new numbered migrations;
  do not edit checksummed applied migrations or loosen RLS for client access.
- No push/deployment was requested or performed. Complete exactly Phase 3, update
  this record, create `phase-3: intent and invite flow`, then stop.
