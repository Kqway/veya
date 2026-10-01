# Phase 9 independent security and correctness review

Date: 2026-10-01. Reviewer: fresh independent review agent, read-only application review; this report is the sole reviewer-written repository artifact. Base: `d5f3b30`. Reviewed working tree, including untracked Phase 9 files, against `docs/production-release-design.md` and `docs/superpowers/plans/2026-10-01-production-release.md`. No staging, commits, or application/test edits by reviewer.

## Findings and disposition

**Final disposition: all six Important findings below are repaired and re-reviewed, including the controller's final integration finding. No unresolved Critical or Important issue was found in the reviewed final working tree.** This approves the reviewed implementation subject to the controller's complete release gates and the external verification limitations below; it is not a claim that production is deployed or externally verified.

1. **Important: production remote PostgreSQL can default to plaintext.** Original `src/lib/config/env.ts` rejected explicit insecure TLS switches but accepted a remote URL without a TLS switch and without `DATABASE_SSL_MODE`; both query pool and LISTEN client consequently used pg's plaintext default. Controller reported this inherited earlier-review finding; this reviewer independently inspected the affected configuration/adapter/runtime paths. Regression must cover both database URLs, absent modes, verified modes and insecure overrides. Fix in progress: production remote URLs select explicit certificate-verified mode.
2. **Important: moderation suspension aborts above 100 affected profiles.** Original `src/features/moderation/runtime.ts` passed every historical pair participant to a publisher rejecting more than 100 recipients (`src/features/realtime/events.ts:11`). Discovery can create enough pair contexts across users/days to reach this size. The thrown error rolls back the suspension transaction. Controller's new regression independently failed in this reviewer's run: `suspends a profile with more than100 recipients without rolling back enforcement`, error `Too many event recipients`. Fix needs bounded publication batches preserving sorted lock order and atomic restriction.
3. **Important: reconnect can permanently omit a middle page of messages.** Original `src/features/social/components/match-screen.tsx:45-48` fetches latest 30 messages, merges them, but ignores the new pagination cursor once any older page was loaded. Load all old history, disconnect, receive more than 30 new messages, reconnect: intermediate new messages are absent and an exhausted older cursor leaves no way to retrieve them. Regression should preserve older history while recovering a latest-page gap, including previously exhausted pagination and capped displayed history.
4. **Important: expired batch leases cancel valid unsent push jobs.** Original `src/features/notifications/jobs.ts:34-56` leases up to 100 jobs for one minute, then processes them sequentially with up to five seconds per push. Later jobs can expire while queued within the same invocation. The authorization query excludes their expired leases; the fallback calls `finish(...,'cancelled')`, permanently discarding valid notifications. Regression should expire a still-owned later job during earlier delivery and prove it remains retryable, while reclaimed ownership/block/session revocation still suppress sending.
5. **Important: local browser tests inherit production connection settings.** Original `tests/e2e/server.ts:25` spreads `process.env` and overrides query DB but not `REALTIME_DATABASE_URL`, `DATABASE_SSL_MODE`, push keys, or runtime limiter. A developer's remote LISTEN URL can therefore cause E2E to access the actual external database; inherited TLS can break the isolated fixture. CI blanks some fields but local tests do not. Regression should poison every external setting and verify explicit isolated child configuration, including prevention of Next loading these settings from local env files.
6. **Important: notification conversation links targeted a nonexistent UI route.** Found by controller during final integration, not during the initial independent review. `src/features/notifications/service.ts` originally emitted `/matches/<key>` and its DTO allowed that path, while the actual page is `src/app/m/[key]/page.tsx`. A user following match/message/plan/reminder notifications therefore received a missing page. Controller reported an observed RED lifecycle regression before fixing this; independent follow-up confirms projection and strict schema now use `/m/<key>`, leaving `/api/social/matches/<key>` unchanged.

### Final repair reinspection

1. Production remote URLs now select `DATABASE_SSL_MODE=verify-full`; query-pool and LISTEN adapters use `rejectUnauthorized:true` and strip conflicting URL TLS options. Reinspection found a duplicate-host bypass (`host=localhost&host=db.example.com`); a direct Node/tsx reproduction showed the original repair selected no TLS while pg selected the remote last host. The final code checks every host and sslmode value, and the regression passes for both main/listener URLs and duplicate hosts.
2. `src/features/moderation/events.ts` deduplicates/sorts participants and publishes each topic in bounded batches of 100 inside the existing restriction transaction. Runtime uses this helper. The native 102-recipient suspension regression now passes, verifies enforcement remains committed, and checks all 102 match invalidations.
3. The chat reload compares the latest page with previously loaded recent keys. On an actual gap it resets to a contiguous latest page and its valid older cursor, with explanatory copy; normal overlapping refreshes preserve loaded history. The DOM regression loads exhausted old history, introduces a larger-than-page gap, refreshes and retrieves the previously missing middle message through restored pagination.
4. Push delivery now checks current job ownership/lease under the profile locks and locks the job before authorizing/send. Expired owned leases return to pending rather than cancellation; stale owners cannot change another worker's job. Final reinspection found that attempts=5 must not return to unclaimable pending; this was repaired to a terminal failed state. Both native ordinary-expiry retry/delivery and final-expiry terminal-state regressions pass. Block/session/binding checks remain in the locked delivery query.
5. `tests/support/e2e-environment.ts` explicitly selects fixture URLs for query/LISTEN, blanks TLS and push/provider credentials, fixes PostgreSQL limiting, and enables the local live path. `tests/e2e/server.ts` uses it. The poisoned-environment regression passes; explicit blank values also prevent Next env-file fallback for these credentials.
6. Follow-up reinspection confirms actual UI page, notification projection and strict DTO agree on `/m/<key>`; lifecycle and reminder expectations and DOM fixtures match. The named recursive notification refresh callback and epoch-object cleanup retain the intended serialized refresh and recovery-response invalidation. The browser profile selector change to the existing accessible `combobox` named `Privacy` is test-only and does not change authorization/UI behavior; actual browser execution remains the controller's gate.

### Minor observation also repaired

Blocking originally published only `connections` and `match`, whereas inbox/badge consumers subscribe to `notifications`, leaving stale items/counts until refresh. The controller also repaired this minor issue: block now publishes `notifications` for both participants inside the same transaction, and the lifecycle assertion checks all three topics. Final source reinspection confirms this change and the named recursive notification refresh callback/epoch cleanup adjustment preserve serialization and stale-response suppression. No remaining actionable minor finding is asserted by this review.

## Reviewed scope

- SSE recipient-only subscriptions and cursors; current profile/session authorization before event frames and on heartbeats; match membership/block filtering; opaque recipient event keys; commit ordering; bounded queues, hub capacity, reconnect/sync, client coalescing and finite retries.
- Notification inbox projection, ownership, bounded unread/read routes; transactional dedupe; block/suspension filters; binding-cascaded subscriptions; HTTPS provider allowlist, encrypted generic payload, no redirects and five-second transport deadline; worker claims, retries, lease ownership, guest/profile/row lock ordering, reminder idempotence and explicit invocation.
- Separate moderator credentials, hashed expiring cookies, secret rotation, Origin checks, rate admission, report-scoped targets, minimal immutable evidence, append-only audit updates, capability enforcement, recovery/suspension behavior, queued-lock reauthorization and active-case retention.
- PostgreSQL shared limiter admission, hashed cookie buckets, global creation budgets, atomic cross-instance updates, fail-closed behavior, bounded cleanup; async limiter call sites.
- Deterministic activity normalization, bounded candidate jobs and indexed pool, reciprocal filters, block/pass/request exclusions, stale lease handling, no automatic Interested; batched discovery and message projection preserving pair Incognito identities.
- Transactional server-only funnel names and idempotent transitions, restricted browser analytics endpoint, aggregate report output without identifiers/content. Existing guest planning remains a bearer-link flow as documented.
- Added SQL migrations 0011–0017, relevant original constraints/triggers and retention interactions. `git diff d5f3b30 -- db/migrations/000* db/migrations/0010*` is empty: original migrations unchanged.
- Docker stages, non-root runner, build-context exclusions, runtime TLS/origin and pool limits, readiness checksums, fixed operational logging, shutdown ownership, worker/migration CLIs, route wrappers, launch client integration, deployment documentation and CI/browser environment setup.
- Relevant added/modified native, unit, DOM and browser test source; inspection is targeted by behavior/security boundaries, not a claim that every assertion or dependency source was independently audited.

## Independently executed verification

- `npx vitest run tests/integration/realtime.test.ts tests/integration/notifications.test.ts tests/integration/candidate-jobs.test.ts tests/integration/shared-limiter.test.ts tests/integration/release-retention.test.ts tests/ui/realtime.test.tsx tests/unit/notifications-push.test.ts tests/unit/notifications-transport.test.ts --maxWorkers=2`: **8 files, 74 tests PASS**.
- `npx vitest run tests/integration/moderation.test.ts tests/integration/social-event-lifecycle.test.ts tests/integration/social-notification-lifecycle.test.ts tests/integration/social-funnel.test.ts tests/integration/social-future-matching.test.ts tests/integration/social-message-query.test.ts tests/integration/social-discovery-query.test.ts tests/integration/social-retention.test.ts tests/unit/env.test.ts tests/unit/deployment.test.ts tests/unit/deployment-shutdown.test.ts --maxWorkers=2`: **10 files PASS; 77 tests PASS, one moderation regression RED** while controller repair was in progress. Failure is finding 2 above, not an unrelated regression.
- Final repairs: `npx vitest run tests/unit/env.test.ts tests/unit/e2e-environment.test.ts tests/ui/launch-ui.test.tsx tests/integration/moderation.test.ts tests/integration/notifications.test.ts --maxWorkers=1`: **5 files, 66 tests PASS**, including all five repaired findings and the final-attempt lease edge. Completed at approximately 19:43 UTC.
- Final minor/cleanup follow-up: `npx vitest run tests/ui/notifications.test.tsx tests/integration/social-event-lifecycle.test.ts --maxWorkers=1`: **2 files, 8 tests PASS** at approximately 19:44 UTC.
- Controller-discovered route repair follow-up: `npx vitest run tests/integration/social-notification-lifecycle.test.ts tests/ui/notifications.test.tsx --maxWorkers=1`: **2 files, 8 tests PASS** at approximately 19:52 UTC; final diff whitespace check also passed.
- Final `git diff --check` passed; original migration diff remains empty. Application/test edits were performed by the controller, not this reviewer.

## Limits

No full suite, build, E2E browser run, dependency audit or Docker build was run by this reviewer; those are controller release gates. No actual hosted TLS/proxy streaming, remote CI, production database, browser push provider delivery, backup/restore or scheduler was exercised. This is a review of application boundaries and selected real PostgreSQL/DOM tests, not proof against every abuse pattern or a production deployment certification. Final repair source and regression results were reinspected after the controller's changes; later material changes require affected review/tests again.

## Controller final release evidence

After the independent re-review, the controller reproduced and fixed two browser
resilience defects: an offline browser event did not close/restart the SSE client,
and an explicitly undefined PushManager was incorrectly treated as supported.
Both received RED→GREEN DOM regression tests and passed desktop/mobile browser
journeys. Final source gates: zero-warning lint, strict types, 586 tests/68 files,
production build, 48/48 Playwright cases and dependency audit with zero known
vulnerabilities. Node 24 non-root Docker build and liveness/readiness smoke passed.
Remote CI, actual hosting/TLS/proxy behavior, real push delivery and backup restore
remain operator verification; no production deployment was performed.

### Container operational follow-up

A subsequent controller smoke found operations-image source/package files retained
owner-only root permissions from the checkout, so non-root migration/worker CLIs
failed before configuration validation. The failure was reproduced with actual
Docker execution. Builder COPY now assigns node ownership; actual non-root runner,
migration and worker smoke passed, including generic no-DB failures. A separate CI
container job deliberately uses restrictive checkout permissions and runs this
regression. Application authorization/projection code was unchanged by this repair.
