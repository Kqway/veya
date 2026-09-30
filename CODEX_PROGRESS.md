# Veya Development Progress

## Current Phase
1

**Status: completed and verified on 2026-09-30.** This execution completed Phase 1
only. The initial repository had README, .gitignore and commit `9af770a`.

## Completed Phases
- **Phase 1 — foundation:** Next.js application, responsive consumer landing,
  validated local draft preview, strict TypeScript, Tailwind, environment
  configuration, PostgreSQL/AI/analytics boundaries, scheduling contract, test
  infrastructure, CI and setup documentation.

## Current Architecture
- Next.js 16.3.8 App Router, React 19.3, TypeScript strict mode with
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, Tailwind CSS 4.
- npm with committed lockfile; Node 24 LTS recommended (minimum 22.12).
- `src/app`: static landing, root shell, metadata/icon, error and 404 pages.
- `src/features/intents`: Zod draft schema, example ideas, client composer.
  Draft input is trimmed and limited to 1–500 characters; blank/oversized values
  receive inline errors. Ctrl/Cmd+Enter submits, preview receives focus, edit
  preserves the normalized draft and returns focus to the input.
- `src/lib/config`: pure Zod parser plus server-only accessor. Defaults support
  local builds with no credentials. Public origin must be an HTTP(S) origin;
  database URI must use postgres/postgresql. Errors contain field names only.
- `src/lib/db`: server-only typed parameterized SQL interface and lazy `pg` pool;
  max 5 connections, bounded connection/query timeouts, explicit close method.
- `src/lib/ai`: generic text contract, server-only factory, deterministic local
  echo adapter validating 1–4000 characters. No remote calls or structured tasks.
- `src/lib/analytics`: roadmap event types and no-op client; no collection yet.
- `src/features/scheduling/types.ts`: domain-only engine extension point.
  No algorithm. date-fns is installed for later scheduling work.
- Vitest + Testing Library for unit/DOM behavior; Playwright desktop/mobile
  Chromium checks against production `next start`; GitHub Actions quality job.
- Design/plan records in `docs/superpowers`; local SVG artwork avoids remote fonts
  and assets. Reduced-motion and keyboard focus styles are included.

## Important Decisions
- Complete Phase 1 only in this execution.
- Work in the supplied clean `work` checkout; one final phase commit.
- Local draft preview is temporary and never creates a persistent intent or invite.
- No credentials are required to build or open the landing page.
- PostgreSQL via `pg` keeps the future schema/provider flexible; Supabase may host
  it later. No extra infrastructure, Redis, microservices or Kubernetes.
- Phase 1 supports `AI_PROVIDER=mock` only. `OPENAI_API_KEY` is reserved server-side;
  OpenAI selection, structured output and fallback handling belong to Phase 5.
- `ANALYTICS_ENABLED` is reserved; the adapter remains a no-op in this phase.
- The user's autonomous instruction overrides skill approval pauses. Work was
  implemented inline, with one independent reviewer; no review findings remained.

## Known Issues
- No blocking Phase 1 failures.
- Live PostgreSQL queries are unverified because no database was configured.
  Schema, migrations, transactions, guest sessions, demo seeds and authorization
  are Phase 2 work. Do not mistake the SQL adapter for a finished backend.
- Drafts disappear on refresh. Persistent intent creation/share/join is Phase 3.
- AI, analytics and scheduling placeholders are intentional Phase 1 boundaries.
- CI was authored but has not run remotely; equivalent commands passed locally.

## Tests Status
Verified on the final source tree:

- `npm run lint` — passed with zero warnings/errors.
- `npm run typecheck` — passed, including generated Next route types.
- `npm test` — **20 passed**, 3 files (environment, mock AI, form interaction).
- `npm run build` — passed, statically rendered `/`, `/_not-found`, `/icon.svg`.
- `npm run check` — passed (lint → types → all unit/DOM tests → production build).
- `npm run test:e2e` — **10 passed**, desktop and mobile Chromium. Covered landing,
  draft submit/edit, whitespace validation and keyboard submit, maximum-length
  layout, refresh behavior and 404 return navigation.
- `npm audit --json` — **0 reported vulnerabilities**, production and development.
- `git diff --check` — passed.
- Manual Chromium screenshot inspection at 1440px and 360px: no horizontal
  overflow; missing Unicode symbols were replaced with deterministic SVG icons.
- Independent whole-change review — no Critical, Important or Minor findings.

Test-first failures were observed before implementing config, mock AI and the
composer. A regression test reproduced malformed database URI handling before
the fix. Browser checks initially hit Next's extra route-announcer alert; the
test selector was narrowed and both projects passed. No current test failures.

## Next Phase
**Phase 2 — database and backend.** Build persistent schema/migrations for User,
Intent, Participant, AvailabilityWindow, Preference, PlanSuggestion, Vote,
AnalyticsEvent and GuestParticipantSession. Add validated data access, high-entropy
public invite IDs, guest sessions, authorization boundaries, seed/demo data and
backend tests. Support collecting/ready/decided/expired states and registration-free
use. Do not start the Phase 3 UI flow in that run.

## Notes for Next Codex Run
- Re-read README, this file, code and git history; confirm Phase 1 evidence before
  choosing work. Do not recreate the foundation or repeat finished UI work.
- Run `npm ci`, then `npm run check`. For browsers, `npm run build` followed by
  `npm run test:e2e`; system `/usr/bin/chromium` is automatically used, otherwise
  install Chromium with Playwright as documented in README.
- `.env.example` runs as-is; external service values can be empty. Configure a
  local PostgreSQL instance for Phase 2 and add real backend integration checks.
- Add transactions and schema/migration/seed commands to the existing SQL boundary
  incrementally. Keep secret access server-only and never log guest input.
- The local composer is an explicit preview; replace its submission behavior with
  real persistent intent creation in Phase 3 after the backend exists.
- No deployment or push was requested or performed. Complete exactly Phase 2,
  update this record, create `phase-2: backend and data model`, then stop.
