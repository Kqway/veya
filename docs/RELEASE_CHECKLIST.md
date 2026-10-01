# Veya Intent Network release candidate

Phases 1–7 and Intent Network 8A–8G are implemented. This checklist separates local
release evidence from host configuration; no production deployment is performed.
See CODEX_PROGRESS.md for exact final test counts and published phase commits.

## Locally verified release gates

- Zero-warning lint, strict TypeScript, complete unit/DOM/native PostgreSQL tests
  and optimized production build via `npm run check`.
- Complete desktop/mobile Chromium journey via `npm run test:e2e`: create, share,
  join/edit/refresh, results, voting/confirmation, optional AI/manual fallback,
  repeat creation, privacy, responsive layouts and explicit overnight entry.
  Social three-person discovery excludes football/other-city candidates, performs
  request/accept/chat/disclosure/ordinary plan/results/block and Veya Key recovery.
- Guest ownership, post-lock wall-clock expiry, stale/revoked completion, safe
  public/own/group projections, narrow preview SQL and offline image rendering.
- Independent AI quota, bounded request body/deadline and plan capacity, limiter
  memory cap/retry response, and explicit dry-run retention against isolated data.
- Dependencies audited, screenshots inspected, staged artifacts/credentials checked.
- Separate read-only whole-social-diff review; reproduced stale request capacity
  and client-navigation/in-flight key loss fixed with regression tests.
- Social recursive forbidden-key DTO tests, viewer-bound handles, pairwise
  incognito identities, native authorization/recovery/block/race constraints and
  no-store responses. Social pages use generic metadata, no profile/post text.

## Configure before a hosted preview

- Node 24 LTS (22.12 minimum), HTTPS Next.js host and explicit public origin.
  Build/start with the intended configuration; verify metadata, cookie security,
  same-origin writes and headers over the actual hostname. Synchronize app/DB time.
- Server-only PostgreSQL URI, verified TLS, trusted owner/BYPASSRLS connection;
  apply migrations 0001–0010 using `NODE_ENV=production npm run db:migrate`.
  Keep direct-client RLS closed. Never seed the production database.
- Multiple instances require shared request limiting or configured gateway global
  limits. Built-in limits are process-local, reset on restart and allow boundary
  bursts; public anonymous traffic can exhaust global budgets. Set abuse/cost
  controls and database capacity for the actual traffic. No client IP header is
  trusted by the application.
- Optional OpenAI: server-only key, allowed api.openai.com egress, strict-JSON
  compatible model, explicit click-triggered parse/assist and working fallback.
  Default mock mode works without keys. Live paid calls were not tested here.
- Keep analytics opt-in; only fixed names/surfaces/timestamps are stored. Never
  attach personal text or invite/session identifiers to host access/error logs.
- Confirm database backups and retention policy. Maintenance is dry-run by
  default, --apply is deliberate deletion (90-day post-expiry intents including
  decided, seven-day unreferenced sessions, 30-day analytics; 100-row batches).
  It is not an HTTP endpoint or automatic startup task. Inspect dry-run counts on
  the exact target before applying, and account for partial category completion.
  Social cleanup: reports365d, abandoned handles/passes90d, expired posts90d,
  inactive pair histories180d with recent/live interaction and report guards.
  Profiles/bindings/blocks persist; no self-service account deletion is included.
  Define account-deletion/evidence retention policy before adding deletion.
- Assign a human owner for reports and establish response/escalation policy before
  public launch. Server-side reporting exists; no moderation console or fake
  automatic enforcement is supplied. Review offline meetup safety/support copy.
- Do not log recovery credentials, JSON chat/disclosure bodies, private post text
  or bearer/session parameters at proxies/error collectors. Test Veya Key create,
  rotation, revoke and recovery on HTTPS; protect database backups/internal IDs.
- Run the complete quality/browser commands in remote CI; local gates do not
  establish remote CI success. Smoke-test create/share/join/vote/confirm on host.
- Exercise actual device native sharing/clipboard and social-platform preview
  caching. Local tests cover supported/cancel/failure paths and Chromium layouts;
  platform share sheets, Safari and other browsers need device checks.

## Preserved limitations

Guest authorization remains browser-cookie based. Social profiles recover through
Veya Key; recovery rotates the key and detaches old social sessions, preserving
posts/matches while original guest coordination ownership is not transferred.
A lost/revoked key plus lost cookie cannot recover the profile in v1. No email/SMS
or federated account provider is required or implemented.

Incognito provides pair-specific API identity, not absolute anonymity. Unique
behavior, shared disclosures and real-world meetings can identify a person; the
server still stores internal relationships. Closed conversations preserve readable
history. Blocking prevents new social actions but cannot retract a received message,
disclosure or copied ordinary invite. Privacy mode cannot erase previously seen data.

Social discovery is bounded to 100 candidates/5 cards and twenty new contexts per
profile/day; a motivated attacker can create separate guests/profiles, so durable
profile quotas do not replace host-level abuse protection. Pair identities persist
for the same pair, not a fresh pseudonym on every message. Group format matches
compatible posts, but v1 connections/chats involve two profiles; ordinary invites
can gather the rest of a group. Coarse time hints use UTC calendar days; exact
availability editing/display uses the browser timezone. Activity normalization
is exact/coarse and mock parsing understands a narrow EN/RU vocabulary.

Results/chat/connections refresh explicitly; no realtime sync, presence/background
AI. AI is reviewed advisory assistance; deterministic social/scheduling cores need
no model. The old scheduler remains bounded to 32 participants/128 windows.

Hosted PostgreSQL, live OpenAI, remote CI and deployment are not verified here.
These are external rollout checks. Core local flow needs no external identity,
email/SMS, chat service, Redis, tracking avatars, browser GPS, ads or payments.
