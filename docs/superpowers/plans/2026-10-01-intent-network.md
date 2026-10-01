# Intent Network implementation plan

> **For agentic workers:** Use executing-plans inline with TDD; independent pure matching/provider tasks may use dispatching-parallel-agents. One fresh whole-diff reviewer after integration. Existing user autonomy authorizes implementation/commits/publication without repeat approval.

**Goal:** Ship complete activity-first seeking/discovery/mutual match/chat/plan v1.
**Architecture:** Separate social tables/service/projections, guest bindings, pure
matching, existing optional AI/scheduler; Next routes and mobile client screens.
**Tech Stack:** Existing TypeScript/Zod/pg/React/Vitest/Playwright; no dependencies.
**Spec:** docs/intent-network-design.md

## Global Constraints
- Keep all guest invite flows and migrations0001–0004 unchanged.
- Server-owned identity, strict projections, no profile/guest IDs/hashes on clients.
- No raw private fields/availability on discovery; Incognito pairwise identities.
- Existing safe JSON/origin/no-store/headers/limiter/AI fallback boundaries.
- No public user catalogue, forced disclosure, production deployment or force push.

## Review Focus
- Incognito candidate handles and identity cannot correlate across viewers.
- Recovery cannot bind an attacker or revive expired/revoked sessions after waits.
- Pair/request/message/block operations share lock order and block cannot be bypassed.
- Plan integration never copies private fields; bearer invite boundary disclosed.
- Changed privacy/expired windows invalidate discovery and pending acceptance safely.

### Task 1: 8A identity and privacy foundation
**Files:** migration0005, social/{schemas,types,privacy,identity,context,errors}.ts,
tests/integration/social-identity.test.ts, tests/unit/social-privacy.test.ts.
**Interfaces:** IdentityService(db): create(token,input),get(token),update(token,input),
recover(token,{key}),rotate(token),revokeKey(token). requireProfile(tx,token) returns
internal profile; reauthorize(tx,token,profileId) after waits. Privacy schemas export
explicit own/discovery/incoming/matched DTOs, no row serialization.
- [ ] Write/run RED creation,18+,session binding/recovery/rotation/revoke/privacy tests.
- [ ] Implement bounded schemas/hash-only recovery, locks and projections; GREEN.
- [ ] Run current suite/typecheck and commit `social: identity and privacy foundation`.

### Task 2: 8B seeking posts and pure engine
**Files:** migration0006, social/{seeking,post-repository}.ts,
discovery/{types,engine}.ts, AI seeking schemas/task/provider extensions,
tests/unit/{discovery,seeking-ai}.test.ts, tests/integration/social-seeking.test.ts.
**Interfaces:** SeekingService(db): create(token,input),list(token),get(token,key),
close(token,key). rankCompatible(source,candidates,{now,blockedPairs?}) returns
internal candidates/reasons only. AiTasks.parseSeeking(input) returns bounded
suggestion, uses existing ParseInput/referenceDate/timeZone and provider deadline.
- [ ] RED hard filtering/time/ranking/workload, seeking ownership/active3/caps/expiry.
- [ ] Implement explicit schemas, relational persistence, pure engine, optional own
  text parsing/manual suggestions; GREEN. Commit `social: seeking and discovery engine`.

### Task 3: 8C private discovery and requests
**Files:** migration0007, social/{pairs,discovery,connections}.ts and native tests.
**Interfaces:** DiscoveryService.discover(token,sourceKey),pass(token,handle);
ConnectionsService.request(token,{handle}),list(token),respond(token,key,{action}).
Opaque viewer handles; pair locks/identities shared with later conversation APIs.
- [ ] RED self/blocked/expired/duplicate/outsider/incognito-unlinkability/accept races.
- [ ] Implement bounded100/5 pool, remembered passes and≤10pending, safe cards,
  atomic mutual accept/match/conversation. GREEN; commit `social: private matching`.

### Task 4: 8D private conversation/disclosure
**Files:** migration0008, social/conversations.ts and native tests.
**Interfaces:** ConversationService.get(token,matchKey),messages(token,key,{before?,limit?}),
send(token,key,{text}),disclose(token,key,{kind,value,consent:true}).
- [ ] RED access/plaintext/pagination/closed/match-only disclosure/block races.
- [ ] Implement DTO schema-checked plain text/pair identity, bounded cursors/consent;
  GREEN. Commit `social: conversation and disclosure`.

### Task 5: 8E ordinary Veya plan bridge
**Files:** migration0009, social/planning.ts and native plan bridge test.
**Interfaces:** PlanningService.plan(token,matchKey)→{publicSlug}, idempotent one/match.
- [ ] RED outsider/blocked/idempotent/private-copy/recovered-session cases.
- [ ] Implement existing intent domain bridge, manually joined existing scheduler
  flow, no raw fields/disclosures copied. GREEN; commit `social: planning integration`.

### Task 6: 8F safety and transport
**Files:** migration0010, social/{safety,http,runtime}.ts, social API route tree,
security/rate-limit.ts, db social retention + CLI integration, native HTTP tests.
**Interfaces:** SafetyService.block(token,{requestKey?|matchKey?}),report(token,input);
social HTTP uses core readJson/tokenFrom/json/apiError and independent budgets.
- [ ] RED block visibility/send/request/accept, reports authorization/caps, limiter
  before expensive work, safe transport errors, social retention dry-run tests.
- [ ] Implement mutual block closure, reports, parameterized routes/no-store/origin,
  explicit cleanup; GREEN. Commit `social: safety and privacy hardening`.

### Task 7: 8G complete social UX and release
**Files:** social client/screens, /discover,/seek/new,/seek/[key],/connections,/m/[key],
landing social entry + retained friend plan, CSS, UI/native/browser tests, docs.
- [ ] RED profile/key UX, manual/AI review post, incognito/recovery, action-first entry;
  desktop/mobile acceptance flow A/B/C, request/accept/chat/disclosure/plan/block/key.
- [ ] Implement accessible mobile-first local-avatar screens, plain text/errors/
  empty/loading/safety copy, generic social metadata. Preserve existing scenarios.
- [ ] Full check, full E2E, audit0, screenshots, immutable migration hash/staged secret
  checks. Independent read-only whole diff review; fix reproduced Critical/Important.
- [ ] Update README/progress/release privacy/limitations and publish normal commits,
  verify remote SHA and clean tree. Commit `social: intent network release`.
