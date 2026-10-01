# Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native controller integration; independent domains may be delegated under dispatching-parallel-agents. Steps use checkbox syntax.

**Goal:** A coherent production release candidate preserving action-first discovery and privacy.
**Architecture:** PostgreSQL owns state; SSE delivers bounded invalidations. Durable notifications/jobs, moderator authorization, shared PostgreSQL limiter and safe aggregate analytics use existing strict service/transaction boundaries.
**Tech Stack:** Node24, Next16/React19, TypeScript/Zod/pg, Vitest/nativePostgreSQL/Playwright, optional standards Web Push.
**Spec:** docs/production-release-design.md

## Global Constraints

- Original0001–0010 immutable; no force push, production deployment or committed secrets.
- APIs never expose UUID/session/recovery hashes/private candidate content/global Incognito identity.
- New locks follow guest shared → sorted profiles → rows; reauthorize current session/binding after waits.
- Realtime is invalidation only; persistent APIs restore every reconnect; finite client retries, bounded server fanout.
- Profile3/posts14windows/tags8, discovery100/5/20contexts24h, outgoing10, chat2000/page50 stay enforced.
- No global directory/feed/dating/followers, presence/GPS/automatic disclosure, paid AI dependency.
- Run full baseline before mutations, RED/GREEN relevant tests per domain, full quality/browser/audit before completion.

## Review Focus

- Recovery/suspension while a live subscription or queued mutation waits must remove authorization.
- Rapid events during an in-flight reload must schedule a follow-up fetch, not lose the final state.
- Block after notification enqueue but before delivery/read must suppress cross-pair information.
- Push endpoint substitution/redirect and shared-limiter concurrent instances must not bypass boundaries.
- Moderator action/retention and future candidate job concurrency must preserve evidence/locks/idempotence.

### Task 1: 9A reliable baseline and CI
**Files:** .github/workflows/ci.yml, Playwright config/server, CI isolation tests, release docs.
**Interfaces:** tests own temporary PostgreSQL and production Next on3100, no configured DB/provider key reuse.
- [ ] Verify npmci/check/E2E actual baseline and immutable hashes; Expected398/43 and38PASS.
- [ ] Add RED test for explicit CI/test isolation and artifact configuration where behavior is meaningful.
- [ ] Keep Node24 non-root embeddedPG, isolated mock provider, build and bothbrowserprojects, failure artifacts.
- [ ] Run relevant guards and commit phase-9a: reliable release baseline.

### Task 2: 9B realtime
**Files:** migration0011, features/realtime/{events,hub,http,client}, api/social/events, tests.
**Interfaces:** publishSocialEvent(tx,profileIds,{topic:connections|match|notifications|discovery,matchKey?}); SocialLiveProvider; useSocialRefresh(topics,asyncCallback,{enabled?}).
- [ ] RED persisted transaction rollback/delivery, recipient-scoped cursors, session/binding expiry, cleanup/coalescing/backoff.
- [ ] Implement recipient outbox, native PG LISTEN hub, bounded authenticated SSE sync/backfill and finite client reconnect.
- [ ] Integrate request/respond/message/disclose/block/plan events; run native/UI; commit phase-9b.

### Task 3: 9C notifications/push
**Files:** migration0012, features/notifications, api/notifications, /notifications, public/sw.js, workerCLI, tests.
**Interfaces:** enqueueNotification(tx,{recipientProfileId,peerProfileId?,type,requestKey?,matchKey?,dedupeKey}); NotificationService list/unread/read; push capability/subscribe/unsubscribe; processNotificationJobs(db,options).
- [ ] RED real lifecycle/idempotence/privacy/readownership/blocked delivery/revoked bindings/SSRF/unsupported opt-in.
- [ ] Implement durable minimal inbox/outbox, safe VAPID opt-in genericpush, bounded jobs/reminders.
- [ ] Integrate domain notifications and realtime, validate; commit phase-9c.

### Task 4: 9D moderation
**Files:** migration0013, features/moderation, api/moderation, /moderation, social/context enforcement, tests.
**Interfaces:** requireCapability(tx,profileId,seek|connect); requireProfile rejects full suspension; admin authorization independent of guest; report-based opaque moderation targets.
- [ ] RED ordinary-user unauthorized/admin expiry/role forgery/evidence immutability/suspension directAPI/queued races.
- [ ] Implement secret-derived expiring admin session, queue/status/evidence/audit, restriction/suspension with locks.
- [ ] Wire capability/candidate exclusion; run native/UI; commit phase-9d.

### Task 5: 9E shared limits
**Files:** migration0014, lib/security shared-limiter/runtime, all rate actions, tests.
**Interfaces:** RequestLimiter.check(action,token) remains; runtime configured PostgreSQL/local provider, quotas global/hashedguest.
- [ ] RED concurrent two-instance quotas/restart persistence/anonymous creation/invalid tokens/fail closed/order/capped cleanup.
- [ ] Implement atomic PG fixed windows, dedicated push/realtime/moderation/profile budgets, production selection.
- [ ] Run native/HTTP/rate tests; commit phase-9e.

### Task 6: 9F funnel
**Files:** analytics types/server tracker, migration0016 constraints, core service integration, aggregateCLI/docs/tests.
**Interfaces:** trackFunnel(tx,event,{enabled}) accepts fixed names only, no client identity/content.
- [ ] RED exactly-once meaningful transitions/idempotent requests/firstmessage/planconfirmation/disabled/forbiddenpayloads.
- [ ] Add bounded server transactional aggregate events and SQL funnel output; validate; commit phase-9f.

### Task 7: 9G cold start
**Files:** migration0017 candidatejobs, features/discovery/candidate-jobs, workerCLI, empty UI/tests.
**Interfaces:** enqueueCandidateJob(tx,postId); processCandidateJobs(db,{limit}) uses pure rank and notification contract.
- [ ] RED incompatible/block/pass/history/noautomaticInterested/idempotent/futurejoblocked races.
- [ ] Implement bounded indexed durable checks, honest empty UX and CANDIDATE_FOUND notifications; commit phase-9g.

### Task 8: 9H normalization
**Files:** discovery/activity-normalization, existing engine/seeking-suggestion/mockparser and unit tests.
**Interfaces:** normalizeActivity(text):{key,label}|null; normalizeActivityKey(value):string; owned input only.
- [ ] RED English/Russian/slang/phrase aliases, unknown preserved, hard privacy/time filters unaffected.
- [ ] Implement extensible deterministic catalogue, wire seeking/server/provider; run oldpure+newtests; commit phase-9h.

### Task 9: 9I production persistence
**Files:** migration0015 indexes, post-repository batch hydration, discovery query, native querycount/plans tests.
**Interfaces:** candidate batch hydrator uses bounded rows under existing sorted locks and reauthorization.
- [ ] RED constant batch query workload/blockedfiltered/statuschangedafterlocks/realRLS constraints.
- [ ] Replace N+1 candidate/message identity hydration where bounded but hot; index hot directional queries.
- [ ] Verify EXPLAIN/index concept and native isolation; commit phase-9i.

### Task 10: 9J deployment
**Files:** Dockerfile/.dockerignore/Nextconfig, health/readiness, env/dbpool/logging/shutdown, deploymentdocs/tests.
**Interfaces:** validated bounded env defaults local-safe; production health no credential/details, ready requires schema/DB.
- [ ] RED invalid env/TLS safeerror/health readiness failure/closed DB/graceful resources/logging whitelist.
- [ ] Implement non-root Node24 container, runtime secrets only, migration/worker/backup/SSEproxy docs.
- [ ] Build/container checks supported here; document actual hosting limitations; commit phase-9j.

### Task 11: 9K independent audit
**Files:** complete diff + scoped regression tests and release evidence.
- [ ] Dispatch one fresh read-only whole-diff reviewer after integration; inspect all security/privacy boundaries from spec.
- [ ] Reproduce Important/Critical RED, fix GREEN, repeat affected/full gates; no unverified audit claim.
- [ ] Commit phase-9k: security audit fixes (or audit evidence if no changes).

### Task 12: 9L launch UX and publication
**Files:** live social screens/rootproviders/notifications badge, mobilepolish/E2E/docs.
- [ ] RED two concurrent users realtime requests/accept/chat/block/reconnect/inbox, unsupportedpush, moderation directAPI, coldstart320px.
- [ ] Integrate minimal action-first live UX/coalesced fetch/offline fallbacks without losing old flows.
- [ ] Full npmruncheck/fullE2E/audit, inspect screenshots/hash/credentials; separate local/remoteCI status.
- [ ] Commit phase-9l, publish normal GitHub commits and verify remoteHEAD; report required owner steps/metrics.
