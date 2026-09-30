# Veya MVP release candidate

All seven development phases are implemented. This checklist separates local
release evidence from host configuration; no production deployment is performed.
See CODEX_PROGRESS.md for exact final test counts and published phase commits.

## Locally verified release gates

- Zero-warning lint, strict TypeScript, complete unit/DOM/native PostgreSQL tests
  and optimized production build via `npm run check`.
- Complete desktop/mobile Chromium journey via `npm run test:e2e`: create, share,
  join/edit/refresh, results, voting/confirmation, optional AI/manual fallback,
  repeat creation, privacy, responsive layouts and explicit overnight entry.
- Guest ownership, post-lock wall-clock expiry, stale/revoked completion, safe
  public/own/group projections, narrow preview SQL and offline image rendering.
- Independent AI quota, bounded request body/deadline and plan capacity, limiter
  memory cap/retry response, and explicit dry-run retention against isolated data.
- Dependencies audited, screenshots inspected, staged artifacts/credentials checked.
- One fresh whole-change review per remaining phase, with reproduced important
  findings fixed and final checks repeated where required.

## Configure before a hosted preview

- Node 24 LTS (22.12 minimum), HTTPS Next.js host and explicit public origin.
  Build/start with the intended configuration; verify metadata, cookie security,
  same-origin writes and headers over the actual hostname. Synchronize app/DB time.
- Server-only PostgreSQL URI, verified TLS, trusted owner/BYPASSRLS connection;
  apply migrations 0001–0004 using `NODE_ENV=production npm run db:migrate`.
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
- Run the complete quality/browser commands in remote CI; local gates do not
  establish remote CI success. Smoke-test create/share/join/vote/confirm on host.
- Exercise actual device native sharing/clipboard and social-platform preview
  caching. Local tests cover supported/cancel/failure paths and Chromium layouts;
  platform share sheets, Safari and other browsers need device checks.

## Preserved limitations

Guest access is browser-cookie based, with no account recovery. Clearing/revoking
it loses that identity. Results refresh explicitly; no live sync/background AI.
Mock understands a narrow explicit vocabulary. Hints are advisory and reviewed;
AI cannot alter scheduling or votes. Scheduling is deterministic and bounded to
32 participants/128 windows; frozen decisions survive expiry until deliberate
retention. Engine deterministic-v2 refreshes old active caches and their votes.

Hosted PostgreSQL, live OpenAI, remote CI and deployment are not verified in this
environment. These are external rollout checks, not unfinished development phases.
