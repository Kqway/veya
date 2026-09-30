# Veya Scheduling Engine Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline with TDD and one independent whole-change review.

**Goal:** Deliver deterministic proposals, private group attendance, votes and a final group decision.
**Architecture:** Pure typed scheduling engine; transactional adapter/cache under intent locks; existing cookie APIs and focused React results components.
**Tech Stack:** Existing TypeScript/Zod/pg/Next/React/Vitest/Playwright. No new dependencies.
**Spec:** `docs/superpowers/specs/2026-09-30-scheduling-design.md`

## Global Constraints
- Phase 4 only; engine independent of AI/UI/SQL/clock.
- 60-minute target; 30-day search; full attendance first; up to three non-overlapping alternatives.
- Internal IDs stay server-side; public suggestion keys, aggregate votes and own vote only.
- Vote guest must be a member; creator alone decides; stale revision/key -> 409.
- English mobile-first UI; one final prescribed commit and fast-forward GitHub push.

## Review Focus
- Candidate boundaries, disjoint/adjacent/short windows and timezone changes never invent attendance.
- Lower attendance never beats larger groups through preference/budget score; mixed currencies are not compared.
- Stale/concurrent writes cannot vote on another intent or resurrect outdated suggestions.
- Public/outsider results cannot expose names, raw windows, notes, budgets, preferences or identities.
- Recompute/failed decision is atomic, stable results preserve votes, decided plans remain frozen.

## Task 1: Engine and summary prerequisites
**Files:** `src/features/scheduling/{types,engine}.ts`, entry form-values/availability formatting,
`tests/unit/{scheduling,entry-values}.test.ts`, UI summary tests.
**Interfaces:** `suggest(input: SchedulingInput): SchedulingResult`; input explicit from/until/duration,
participant `{id,availability,preferences,budgetMin,budgetMax,currency}`; candidates include window,
full/partial IDs, score, activity, budget assessment, quality/shortened and explanation.
- [x] Write failing engine tests for all spec scenarios plus quoted preference append and overnight summary.
- [x] Run tests, observe RED; implement pure boundary/grid/segment ranking and formatting/parser fixes.
- [x] Verify engine invariants and prerequisite tests GREEN; ledger result.

## Task 2: Durable results, votes, decision and HTTP
**Files:** migration `0003_scheduling.sql`; backend `results-{types,repository,service}.ts`;
repository invalidation/service delegation/errors/http/routes/runtime analytics; native tests.
**Interfaces:** VeyaBackend `getResults(slug,token?)`, `vote(token,slug,{suggestionKey,revision,value})`,
`decide(token,slug,{suggestionKey,revision})` return ResultsView. Values yes/maybe/no.
- [x] Write failing native DB tests for stable results/keys, own/member/public views, vote upsert,
  forgery/cross-group/revoked/expired/stale rejection, recompute/concurrency and creator decision freeze.
- [x] Observe RED; implement migration/locked cache/projections and delegate service methods.
- [x] Add routes using same JSON bounds/origin validation; add bounded result_viewed tracking and server vote_submitted.
- [x] Verify all native/engine tests and strict types; ledger result.

## Task 3: Results and voting UI, verification and publication
**Files:** `src/features/scheduling/components/{results-screen,proposal-card}.tsx`, result route,
invite CTA/participant privacy hint/CSS; UI/browser tests; README/CODEX_PROGRESS/plan.
**Interfaces:** ResultsView drives anonymous/member/creator controls, revision/key submitted via cookie API;
proposal card emits vote/decision actions; stale errors reload current ResultsView.
- [x] Write failing DOM expectations for voting/retry/stale/confirmed/no-availability controls.
- [x] Implement responsive result page and entry transitions, local summaries and optional tracking.
- [x] Add real desktop/mobile create/join/result/vote/refresh/recompute/confirm/closed flows.
- [x] Run npm run check, all Playwright projects, npm audit; inspect screenshots/overflow.
- [x] Obtain independent review and one necessary fix pass with RED→GREEN verification.
- [x] Update docs/progress/plan, review staged diff/secrets, commit `phase-4: scheduling engine`, fast-forward publish, verify clean/remote SHA and stop.

Verification: 115 tests/16 files plus lint/types/build; 22 desktop/mobile E2E;
audit 0 vulnerabilities. One fresh review, three Important findings reproduced
and fixed in one pass (34 targeted checks). No Critical/Minor findings or re-review.
Durable decisions, limitations and next Phase 5 are recorded in CODEX_PROGRESS.md.
