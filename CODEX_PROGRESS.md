# Veya Development Progress

## Current Phase
8D

**Status: Intent Network implementation in progress (2026-10-01).** Existing
Phases1–7 remain complete (base f86dd52). User authorized full sequential8A–8G
social extension and prior GitHub publication; no production deployment.
8A–8C domain implementation complete; final UX/browser/docs publication continues.
Full integrated current working-tree check passes398tests/typecheck/lint/build;
remaining phase commits and complete browser release gates continue.

## Completed Phases
- **Phase 1 — foundation** (`5766774`): responsive landing, strict Next.js/React/
  TypeScript, Tailwind, service/configuration boundaries, tests and CI.
- **Phase 2 — database and backend** (`aeb73e0`): nine tables, checked migrations,
  RLS boundary, transactions, guest sessions, authorized APIs and database CLI.
- **Phase 3 — intent and invite flow** (`3544ab4`): persistent creation/sharing,
  no-account participation, local availability, budgets/preferences, guest editing
  and bounded opt-in entry analytics.
- **Phase 4 — scheduling engine** (`f969f52`): deterministic overlap, compromises,
  alternatives, cached results, privacy-safe attendance, votes and confirmation.
- **Phase 5 — AI layer** (`3a0c9c3`): reviewed structured parsing, public advisory
  hints, optional meetup ideas and grounded explanations, mock/OpenAI fallback.
- **Phase 6 — viral UX** (`131dd1f`): compact mobile creation, focus/loading/
  selection feedback, resilient sharing, offline public-only previews and repeat
  creation with bounded navigation-safe analytics. Published and remote verified.
- **Phase 7 — release hardening** (`phase-7: release hardening`): post-lock
  temporal authorization, saved elapsed-window editing, overnight entry, unmount
  guards, bounded API/scheduler workload, headers, explicit retention and release
  verification. All domain-audit findings fixed; fresh final review has no findings.

## Current Architecture
- Next.js 16.3.8, React 19.3, strict TypeScript with unchecked-index/exact optional
  checks, Tailwind4, Node24 LTS recommended (22.12 minimum); no new infrastructure.
- Landing, `/i/[slug]`, results and Node JSON APIs. Public preview SQL selects only
  organizer/effective status; no cookies/private records. Bundled-font PNGs use
  bounded ASCII names or generic copy; Unicode names remain in metadata. No fonts
  or emoji are fetched remotely. Invite/results are noindex; data/images no-store.
- Entry browser API: 15-second request deadline, exact integer-minor-unit currency
  conversion, explicit local timezone/DST validation and overnight end dates.
  Forms preserve own fields and unchanged saved elapsed windows, reject new past
  ranges, prevent duplicate submits and stop follow-up requests after unmount.
- Backend: strict schemas, parameterized SQL, hashed 30-day guest cookies, own/
  public/member projections and guest→intent transaction lock order. Wall-clock
  expiry and session access are checked after lock waits, before writes.
- Pure UTC scheduler, independent of AI/UI/database/clock, with deterministic-v2
  fingerprints, full attendance first, preference/budget/quality ranking, 60-minute
  target, shortened boundary spans and up to three distinct alternatives. Maximum
  32 participants and 128 total windows, enforced under lock and in pure engine.
- Results cache/revisions, member YES/MAYBE/NO votes and creator confirmation.
  Changes regenerate active proposals/clear old votes; stale selections get409.
  Frozen decided snapshots remain authoritative after expiry, until retention.
- Lazy bounded pg pool, pinned transactions, advisory-lock/checksum migrations,
  server-only RLS; migration0004 adds retention indexes without altering prior SQL.
  Server owns tables or has BYPASSRLS; no permissive direct-client policies.
- Process-wide replaceable async-compatible RequestLimiter, independent global/
  hashed-guest60-second buckets, at most4096 active guest/action entries. Checks
  precede body/database/provider work; safe429 Retry-After. No trusted IP headers.
  Core, AI and analytics have independent budgets; distributed host needs shared
  limiting/gateway. JSON body≤16KiB with whole-body5s deadline and safe408.
- Security headers: nosniff, DENY frame, no-referrer, camera/microphone/location
  disabled; same-origin CORP on APIs and X-Robots-Tag on invite paths.
- Explicit maintenance CLI, default dry-run, deliberate --apply, up to100/category:
  intents90days after expiry including decided and cascades; unreferenced guest
  sessions7days after expiry/revocation; analytics30days. Separate bounded
  transactions and SKIP LOCKED; production requires explicit DATABASE_URL.
- Optional AI: strict structured tasks, narrow deterministic EN/RU mock, server-
  only OpenAI native fetch, output/semantic validation and local fallback. Prompts
  use public intent and aggregate proposal facts; no participant private records.
- Disabled-by-default analytics: six fixed browser names and three server names;
  enumerated surfaces/timestamps only. Repeat event accepts invite/result only.
- Vitest/Testing Library and isolated native PostgreSQL; Playwright owns its own
  PostgreSQL and production Next server, desktop/mobile Chromium in Moscow time.

## Important Decisions
- Latest “Закончи до конца” superseded the earlier one-phase stopping rule: finish
  Phases6–7 in this run with separate prescribed commits and normal fast-forward
  GitHub main pushes. Supplied work branch; no force push, new deployment or PR.
- Guest cookie HttpOnly/SameSite=Lax/Secure in production; SHA-256 hash at rest.
  High-entropy slug grants public invitation visibility. Only own membership exposes
  raw private fields; named derived attendance is creator/member-only.
- Same-origin mutation/JSON boundary. No client-supplied internal identities; public
  proposal keys are opaque32hex with safe revision. Server/DB clocks must be synced.
- Creator joins separately; only current members vote, only active creator confirms.
  Duplicate joins and identical votes/confirmation remain idempotent. Closed plans
  cannot be reopened by collection expiry, creator close or assistance.
- Scheduling fallback must cover accepted sub-minute boundaries correctly and offer
  at least a one-minute real interval. Versionv2 refreshes old active caches, keys
  and votes on read; decided/expired stored proposals are not regenerated.
- Preferences affect ranking without exposing raw text; numerical budgets stay
  private and currencies are never converted. Similar dietary preferences do not
  establish food safety. AI hints are reviewed public advisory text, not constraints.
- AI explicit clicks only. Parse previews require Apply; plan ideas render as plain
  text and explanation uses applicable trusted reason codes. AI never changes votes,
  scheduling or decisions. Generation outside transactions, access/revision rechecked
  on completion. Missing key/network/malformed/refusal/timeout uses local fallback.
- OpenAI fixed endpoint, strict JSON schema, gpt-4.1-mini default,1000 output tokens,
  store=false,64KiB envelope,8s whole-call timeout, no retries/redirects/raw logging.
- Request limits and maintenance defaults are documented in README; process-local
  enforcement is a bounded preview guard, not a distributed public-host guarantee.
  Anonymous exhaustion can deny peers temporarily; gateway policy is host-specific.
- Retention never automatic/API-triggered. Back up/check exact target before apply;
  dry-run counts are projections, and separate transactions may partially complete.
  No cleanup was executed against actual development or production data.
- Applied native execution/TDD, independent read-only domain audits and one fresh
  whole-change review per phase. Necessary findings reproduced and fixed; no repeated
  review or speculative features. Existing user authority overrides approval menus.

## Known Issues
- No blocking local failures or deferred review findings.
- Live OpenAI has no configured key/allowed egress here. Injected transport tests
  cover request validation/timeouts/failure/fallback; host needs permitted egress
  and a model supporting strict JSON. Default mock needs no credentials/network.
- Hosted PostgreSQL/Supabase, production deployment and remote CI were not verified.
  Local native PostgreSQL and production-browser flows pass. See
  docs/RELEASE_CHECKLIST.md for concrete host and rollout checks.
- Actual device share sheets, social preview cache behavior and Safari/other browsers
  require device checks. Chromium capability/cancel/failure/layout paths are covered.
- Cookie loss/revocation loses that guest identity; no account recovery. Mock has a
  narrow vocabulary; hints do not constrain schedules. Results refresh explicitly;
  no live sync, background AI or autonomous coordination is part of this MVP.
- Built-in limiter resets per process/restart and permits fixed-window bursts.
  Multiple instances require shared adapter/gateway; public cost/traffic limits and
  database sizing must be configured for the actual deployment.

## Tests Status
- Final `npm run check`: lint with zero warnings, generated route types, strict
  TypeScript, **206 tests in30 files**, optimized production build — PASS.
- Final complete desktop/mobile `npm run test:e2e`: **34/34 — PASS**, real isolated
  PostgreSQL and production Next. All earlier create/share/join/edit/results/vote/
  decide/privacy/AI/repeat flows pass, plus overnight refresh/security headers and
  manual creation after AI429. Screenshots inspected; no overflow/browser errors.
- Native hardening/retention subset **13/13**: queued invite/session expiry, capacity/
  duplicate admission, own-membership privacy ordering, saved elapsed editing,
  dry-run/cascade/reference preservation, bounded/idempotent cleanup and skip locks.
- Targeted limiter/HTTP/body/lifecycle/date/engine checks PASS: safe429 before expensive
  work, independent budgets, memory cap/no eviction/clock clamp, stalled cancellation,
  unmount request/redirect guards, past-window validation and short-span ranking.
- Three read-only domain audits reproduced temporal authorization, saved elapsed
  editing and unmount bugs. Accepted sub-minute fallback impact regraded Important.
  Regression RED→GREEN for all findings; added outsider capacity regression fixed
  ownership-before-limit error precedence. A retention fixture CHECK failure was
  corrected by setting aged creation timestamps, preserving production constraints.
- Fresh independent whole-change Phase7 reviewer (gpt-6-astra/high): **zero Critical,
  Important or Minor**. No fixes/re-review required. Phase6 review's two Important
  preview/privacy findings were reproduced and fixed before its177-test/30-browser
  publication. No outstanding findings from either phase.
- `npm audit --json`: **0 vulnerabilities**; no dependencies added. Migration list
  includes0004. Staged whitespace, credential-pattern and artifact inspection PASS;
  no runtime data, .env secrets, screenshots, debug logs or test output committed.

## Next Phase
**Intent Network Phases8B–8G are authorized and in progress.** Read
docs/intent-network-design.md and docs/superpowers/plans/2026-10-01-intent-network.md.
Finish seeking/matching, discovery/requests, chat/disclosure, plan bridge, safety
and complete UX/release gates. Original coordination MVP remains complete.

Previous post-MVP guidance (superseded for this authorized extension): On a future
run choose one evidence-based improvement cycle from the original roadmap. Current
highest-impact candidate is reliability: verify the selected hosted environment's
DB/TLS/migrations, shared limiting and optional provider fallback using the release
checklist when a target/credentials are available. Do not invent unrelated features
or redevelop completed phases. Use `improvement: <short description>` for later work.

## Notes for Next Codex Run
- Verify history/tree/remote before trusting this file. Read README and release
  checklist; Phase7 commit title and implemented safeguards establish completion.
- Run npm run check/build before test:e2e; tests own ephemeral DB/port3100 and force
  mock/no key. Never reset or clean development/production databases via tests.
- Preserve guest/session ownership, post-lock expiry, privacy, result revisions,
  frozen decisions, optional reviewed AI and narrow offline preview projection.
- Retention deliberate --apply only, dry-run default and production URI required.
  Prior migration checksums remain immutable; add new numbered files if needed.
- Normal fast-forward GitHub publication is authorized; no deployment target or PR
  was requested. Complete all seven phases, then stop; future runs one improvement.
