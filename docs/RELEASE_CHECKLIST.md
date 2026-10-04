# Intavro closed beta release candidate

Phases 1–9 retain the action-first Intent Network and original invitation/scheduling
flow. Local verification and hosted rollout evidence are separate. Exact local
counts/commits and remote CI status are recorded in CODEX_PROGRESS.md.

## Vercel + Neon hosting

- Follow [VERCEL_NEON.md](VERCEL_NEON.md): Node 24/Fluid compute, trusted HTTPS origin,
  verified-TLS pooled `DATABASE_URL` and direct `REALTIME_DATABASE_URL` for the same
  database, shared PostgreSQL limiter and independent moderator/Cron credentials.
- Keep preview credentials separate from production. Apply/verify 0001–0018 manually
  using the direct endpoint before real-user rollout; never migrate during web build.
- Reproduce full E2E twice: ordinary runtime and `VEYA_TEST_VERCEL=1` isolated runtime.
  Verify actual SQL/font NFT assets, final LISTEN cleanup and retained stream caps.
- Daily Hobby-compatible Cron is a configuration baseline. Use a minute scheduler
  for beta candidates/push/reminders; do not apply destructive retention from Cron.
- Read [security-vercel-review.md](security-vercel-review.md); verify four-minute
  streaming/reconnect, simultaneous users, moderation, deletion, backups and mobile
  behavior on the actual HTTPS host. Local/CI PASS does not prove hosted deployment.

## Russian interface and brand compatibility

- Verify Russian labels, metadata, dates, errors, inbox/push and moderation on desktop
  and 320px mobile Chromium. Public branding is Intavro; stored user text remains intact.
- Preserve the existing `veya_guest`/moderator cookies, DB/channel/lock namespaces,
  migration checksums, recovery secrets and invite URLs. No migration is required.
- Read an existing voted/finalized plan after upgrade: localized presentation must
  preserve semantic fingerprints, suggestion keys, revisions and votes.
- Verify standalone `/opengraph-image` renders a no-store PNG using bundled licensed
  Cyrillic fonts without external requests. Domain/trademark availability still needs
  owner verification; the GitHub-name search alone does not establish legal uniqueness.

## Repository release gates

- `npm ci`; `npm run check` (zero-warning lint, strict types, all unit/DOM/native
  PostgreSQL tests and production build); full `npm run test:e2e`; `npm audit --json`.
- Clean installs include `.npmrc` and `tools/next-root-glob`; Docker copies both
  before dependency installation. Recheck the narrowly scoped Next lint override
  when upgrading the plugin; all its lint rules remain enabled.
- CI repeats all gates with Node 24, isolated temporary PostgreSQL and installed
  Playwright Chromium on non-root runners; both desktop/mobile projects execute.
  Browser retries are disabled: a broken first attempt fails the gate. Every run
  retains verification logs and available screenshots/traces, including cleanup
  failures. Independent journeys are paced within unchanged global production
  budgets; simultaneous actors and concurrent worker processes remain covered.
  No development/production database or paid AI is used.
- E2E covers original coordination, incognito seeking/discovery/request/match/chat/
  disclosure/plan/results/block/recovery, two users live simultaneously, realtime
  reconnect repair, notification inbox, unsupported/denied push, protected moderator
  suspension, honest cold-start empty state, reduced motion and 320px layouts.
- Independent read-only security/privacy review of the Phase 9 diff, followed by
  reproducible regression tests and fixes; see security-phase9-review.md and security-closed-beta-review.md. Verify
  there are no known unresolved Critical/Important issues and no committed secrets.
- Applied migrations 0001–0017 remain unchanged. Addition 0018 and the existing set are checksum-tracked,
  transaction-safe, indexed and server-only/RLS protected. Never edit applied SQL.
- Typed-confirmation profile deletion invalidates keys/bindings and delivery, erases
  personal social content, closes conversations and preserves frozen moderation
  evidence. Verify sequential deletion of both linked-plan participants.
- Signup/seeking/read-only flags are enforced before expensive work. Stateful discovery
  pauses in maintenance; result/connection reads do not persist domain changes.
- Sensitive APIs are no-store; server-owned sessions authorize every action and
  SSE subscription. Explicit DTOs omit database/profile/session identities, private
  candidate windows/location, contacts and global incognito identity.

## Owner steps before real users

- Configure Node 24, domain and HTTPS, trusted public origin, Secure/HttpOnly cookies,
  reverse proxy limits and unbuffered SSE; smoke-test actual browser reconnects.
- Provision server-only PostgreSQL with verified TLS and trusted server role; set
  pool sizes plus one dedicated session-mode LISTEN connection per web instance.
  Apply migrations from the release before rollout. `/api/ready` must return 200;
  `/api/health` is liveness only. Test graceful shutdown and unavailable DB behavior.
- Keep production `RATE_LIMIT_BACKEND=postgres`; do not select process-memory limits
  with multiple instances. Verify host/gateway connection budgets and early quota
  rejection. Veya does not trust forwarded IP headers or fingerprint users.
- Generate a random server-only MODERATION_ADMIN_SECRET, assign a human moderator
  and response/escalation policy. Exercise login, review/audit, seek/connect
  restrictions and full suspension via direct APIs. Rotating the secret invalidates
  admin sessions. No AI moderation or automatic bans are used.
- Schedule `npm run social:process` periodically (e.g. every minute), monitor bounded
  candidate/push backlog and failed jobs. Without a scheduler there are no background
  candidate notices, reminders or pushes; API discovery/chat still work normally.
- Web Push is optional: configure all three VAPID values, HTTPS and supported browser
  provider egress. Test explicit opt-in, generic lock-screen payload, disable,
  permission denied and unsupported browser. Push delivery is not read receipt.
- Set opt-in ANALYTICS_ENABLED only if aggregate measurement is desired. Use
  `npm run analytics:funnel -- 7`; distinguish event totals from seeking-cohort
  conversion and confirmed plan time from actual meeting attendance.
- Review `db:cleanup -- --dry-run`, then schedule bounded `--apply` only on the intended
  database with tested backups. Events24h, notifications30d, terminal worker jobs/
  expired admin sessions7d; original post/history/guest retention still applies.
  Open/reviewing reports protect evidence/context indefinitely; resolved/dismissed
  reports365d. Moderator audits and stable profiles need an explicit owner policy.
- Run both non-root container smokes, including disposable real PostgreSQL migrations/
  concurrent workers and logical backup/restore; read-only controls preserve safety
  actions and skip background mutations. Check `ops:status` plus timer/worker exit logs: an
  empty queue does not establish that the scheduler is healthy.
- Protect runtime secrets, backups and proxy logs. Never log cookies/recovery keys,
  private intent/chat/disclosure bodies or exact availability. Regularly restore an
  encrypted backup into an isolated environment and measure recovery time. Before
  promotion, reconcile post-backup deletions, revoked keys/sessions, blocks and
  moderation state; this release has no external automatic revocation journal.
  Keep uncertain restores isolated. See DEPLOYMENT.md for the complete procedure.
- Confirm actual remote GitHub Actions PASS for the published commit; local PASS does
  not establish hosted PASS. Test real TLS certificates, proxy streaming and mobile
  devices/Safari separately. No production deployment is performed by this task.

## Product and privacy limits

Incognito means pair-specific API pseudonyms, not absolute anonymity. Operators
hold internal relationships; personal disclosures, behavior or real-world meetings
can identify people. Blocking cannot retract already seen content or copied bearer
plan invitations. Recovery preserves social identity but does not transfer original
guest ownership of coordination plans. A lost key plus lost cookie is unrecoverable
without an additional identity provider; no own-password system is used.

Discovery uses at most100 candidates/5 cards, three active posts, ten outgoing pending
requests and twenty new contexts/profile/day. Matching is deterministic; activity
normalization is a bounded local vocabulary, not arbitrary semantic understanding.
Coarse hints use UTC days; editing uses browser time. Group-compatible discovery
still connects two profiles; ordinary invitations coordinate larger groups.

SSE uses bounded streams/backfill/retries and manual API recovery; neither SSE nor
push is the source of truth. Worker checks are bounded and need an actual scheduler.
Shared limits and global creation quotas mitigate abuse but do not establish verified
human identity or eliminate multi-guest Sybil attacks. There is no public user
catalogue, dating/swipe mechanic, followers, ads, GPS, presence or last seen.

Browser failure traces can contain synthetic recovery keys and private test messages.
Restrict artifact access and retention; never collect equivalent real-user traces
without an explicit privacy policy.
