# Veya MVP completion plan

> **For agentic workers:** Use executing-plans inline with TDD, independent audit domains via dispatching-parallel-agents, and one fresh whole-change reviewer per phase. User authorized finish through Phase 7; one prescribed commit each.

**Goal:** Complete mobile/viral UX and harden the locally working MVP.
**Architecture:** Existing Next/React/pg boundaries, optional AI unchanged; focused metadata/CTA/loading modules, bounded replaceable limiter and maintenance CLI.
**Tech Stack:** Existing TypeScript/Zod/Vitest/Playwright, built-in ImageResponse/crypto; no additional infrastructure.
**Spec:** docs/superpowers/specs/2026-09-30-completion-design.md

## Global Constraints
- Preserve guest authorization, deterministic scheduling and all Phase1–5 flows.
- No private fields, query IDs, keys or raw intent text in previews/analytics.
- 320px layout, >=44px interactive targets, reduced motion respected.
- No deployment, paid provider testing, destructive automatic cleanup or force push.
- Separate phase-6: viral UX and polish / phase-7: release hardening commits.

## Review Focus
- Invite metadata never calls results/member APIs or emits private participant data.
- Repeat CTA fires only bounded events on click; disabled analytics stays silent.
- Sharing cancellation/failed clipboard preserve usability and prevent duplicates.
- Expired/revoked/stale sessions cannot gain writes through UI or AI assistance.
- Limiter bounds memory/work and trusts no spoofable IP headers; core fallback stays usable.

## Task 1: Phase 6 functionality
**Files:** analytics browser/HTTP, entry repeat-plan/loading/shared preview helpers,
invite/results pages + image, share-panel, invite-screen, participant-form,
availability-picker, composer/CSS; unit/native/DOM/browser tests.
**Interfaces:** RepeatPlan({surface:invite|result}); useAnalytics(name,surface?)
new_intent_from_invite only invite/result; getInvitePreview(slug): safe title/copy;
LoadingPlan({results?}); SharePanel({slug,creatorName?}).
- [x] Add and run failing preview privacy, repeat CTA/analytics and share duplicate/fallback tests. Expected RED missing helpers/event/guards.
- [x] Implement public-only previews/images, tracked CTA and resilient sharing; add focus, loading, feedback and compact responsive CSS without additional mandatory clicks.
- [x] Run targeted GREEN and complete quality/browser gates. Inspect 320px/mobile/desktop screenshots. Expected all pass.
- [x] Fresh whole-change review; reproduce/fix Important/Critical once. Document, commit/push Phase 6 and verify SHA.

## Task 2: Phase 7 audit and safeguards
**Files:** targeted findings; lib/security/rate-limit + backend HTTP/runtime;
next.config.ts; scripts/database.ts + retention module; tests; README/progress.
**Interfaces:** limiter.check(action,guestToken?): decision with retryAfterSeconds;
check before expensive API work, shared runtime instance; maintenance explicitly
selects production URI and dry-run by default, applied retention only with flag.
- [x] Independent read-only backend/privacy, scheduling/date and UI/AI/transport audits; consolidate real findings without shared edits.
- [x] Write failing tests for actual findings and bounded limiter/headers/retention contracts; observe RED before implementation.
- [x] Implement smallest fixes and safeguards; meaningful targeted GREEN.
- [x] Complete check/browser/audit/manual screenshots, one whole-change review and fix pass if required. Update release docs/progress with external limitations.
- [x] Commit/push Phase 7, verify remote SHA and clean tree; stop when roadmap complete.
