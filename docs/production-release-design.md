# Production release candidate — Phase 9

## Goal and authority

Preserve the action-first Intent Network and ordinary guest coordination flow.
Make connection/chat changes immediate, recover from dropped events using persistent
APIs, provide private notifications and opt-in push, human moderation and shared
abuse limits. User authorizes autonomous implementation9A–9L and earlier normal
GitHub publication; no production deployment, old migration edits or history rewrite.
Base verified d5f3b30, npmci/check398/43/E2E38PASS. Real hosting credentials are absent.

## Realtime architecture

SSE is the smallest browser-compatible one-way channel; WebSocket requires extra
connection infrastructure without improving this request/response domain. External
providers add privacy/operational obligations. Choose transactional PostgreSQL
invalidation outbox + LISTEN/NOTIFY and per-process authenticated fanout. Persistent
APIs remain the source of truth. Publish only topics and an optional authorized
match public key; no content, aliases, IDs or scores. Each recipient gets its own
random event key. Subscription is current-session/profile-owned; no client profile
or arbitrary match subscription. Cursor resolution is recipient-scoped; fresh/
reconnect/overflow always sends sync and clients refetch state. Finite reconnect
backoff, cleanup, bounded fanout/backpressure/stream lifetime and session/binding
reauthorization. Heartbeats validate access; they do not poll for changes. A dedicated
LISTEN connection per instance uses a session PostgreSQL connection, not transaction
pooling. UI exposes offline/retry/manual API fallback, no presence or typing.

## Notifications and push

Persistent notification inbox, unread count and bounded read/mark routes. Types:
INTEREST_RECEIVED, INTEREST_ACCEPTED, NEW_MESSAGE, PLAN_READY, MEETUP_REMINDER,
CANDIDATE_FOUND. Internal recipient/context/peer fields never serialize. Public
DTO: random publicKey,type,createdAt,readAt,local href. Idempotent server dedupe and
block/suspension/session checks. PostgreSQL jobs are claimed with SKIP LOCKED,
bounded retries and safe failure states. Confirmed linked plans permit one reminder
per match/start/recipient within24h before start, driven by explicit worker execution.
No event is evidence of delivery/read by the recipient. Push opt-in only after a
clear action; unsupported/denied browsers keep working. Generic Veya notification
text and /notifications URL, never names/activity/location/chat. Known HTTPS browser
push endpoints only; no arbitrary outbound URLs/redirects/private hosts. VAPID keys
and public HTTPS origin required only to enable push. Disabling removes the current
browser subscription; stale/unbound/revoked endpoints never receive messages.

## Moderation

Server-only configured random admin secret authenticates a separate expiring admin
session, HttpOnly/SameSite/Secure, never client role flags. No hardcoded credential.
Bounded report queue with open/reviewing/resolved/dismissed, minimal report-related
profiles/posts/recent conversation evidence, audited reads/actions. No contact
or recovery/session fields. Report public identifiers are distinct from profile IDs.
Moderator can restrict new posts/connections or suspend a profile. Authorize every
API; enforce capability under profile locks in services, including direct requests.
Full suspension closes affected social conversations/requests; recovery cannot
remove restrictions. User block remains separate. Evidence immutable; active case
retention protected, action history retained separately from ordinary cleanup.

## Shared limiting and analytics

Keep RequestLimiter interface and local mode for development. Production chooses
PostgreSQL atomic shared global/hashed-cookie fixed windows, fail closed safely,
bounded bucket cleanup. No IP/fingerprinting/X-Forwarded-For trust. Dedicated budgets
cover profilecreate/recovery/seeking/discovery/Interested/chat/report/AI/push/SSE/admin.
Global creation limits, durable profile quotas and human controls reduce Sybil
impact; do not claim prevention of all multi-profile abuse.
Funnel events emitted by successful server transactions only, disabled by default:
seeking_created, discovery_results_seen, interest_sent/received, match_created,
first_message_sent, plan_created/confirmed. Enumerated names/surfaces/timestamps;
no correlation/profile/session identifiers or private content. Idempotent action
transitions prevent retries from inflating counts. SQL aggregate CLI measures action
counts and cohort-free ratios, not per-user attribution or proof of actual attendance.

## Cold start and search

A saved active post remains eligible. New compatible post creation enqueues a
bounded durable matching job; explicit worker checks deterministic mutual filters
against indexed100-post pool, skips block/pass/request/suspended profiles and notifies
eligible owners once per source/target context. No automatic Interested. Tell users
clearly when checks run; no background matching promise without configured worker.
Extensible pure EN/RU activity catalogue recognizes chess/shakhmaty/slang/phrases,
keeps unknown activities manual, AI parses own text only. Canonical activity keys
are deterministic; strict privacy/hard temporal filters remain unchanged.
Batch discovery hydration/projection avoids per-candidate window/tag/profile queries.

## Persistence and deployment

Add numbered migrations0011events,0012notifications/push/jobs,0013moderation,
0014sharedlimiter,0015query/index hardening,0016analytics,0017candidatejobs. All0001–0010
unchanged. PostgreSQL constraints/RLS/tracking remain authoritative. Index recipient
unread/events, conversation cursor, moderation queue, directional pending/history,
activity-active discovery. No O(all users) scan per request.
Node24 non-root Docker release, no secrets in build context/image, health/readiness,
bounded connection configuration, safe logging and shutdown. Session-mode connection
for LISTEN; normal query pool separately bounded. Document TLS/public origin, backups,
migration job, worker schedule, dry-run retention, SSE proxy buffering/timeouts and
optional VAPID/OpenAI. Local gates and GitHub Actions evidence explicitly separate.

## Verification and limits

Real isolated PostgreSQL integration/auth/constraints/notification/jobs/moderation/
limiter/SSE tests, pure matching/normalization, DOM opt-in/offline/refresh tests and
Playwright two concurrent users, live requests/accept/chat/block/reconnect/inbox,
unsupportedpush/moderation/coldstart/320px. No production DB or paid API in tests.
One fresh separate read-only security/privacy review of the whole diff, Important/
Critical findings reproduced RED→GREEN and fixed, then full check/build/E2E/audit.
Live browser push delivery, actual hosted TLS/backup/remoteCI depend on external
access; document concrete evidence and remaining owner steps without claiming PASS.
