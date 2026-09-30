# Veya Intent and Invite Flow Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, with test-first steps and one independent whole-change review.

**Goal:** Deliver persistent create/share/join without registration.

**Architecture:** Existing authorized JSON APIs, focused browser helpers and React
forms/screens; isolated PostgreSQL production-browser verification.

**Tech Stack:** Existing Next/React/TypeScript/Zod/pg/Vitest/Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-30-entry-flow-design.md`

## Global Constraints
- Phase 3 only; no scheduling or AI implementation.
- HttpOnly guest cookies; budgets integer minor units; ISO UTC availability.
- Existing privacy/authorization projections stay intact.
- English mobile-first UI matching the existing paper/terracotta theme.
- Publish to GitHub main with fast-forward only; one final phase commit.

## Review Focus
- Revoked editing credentials must not replace identity or overwrite someone else's data.
- DST, currency fraction digits, partial/past ranges and persisted data must not change silently.
- Network/clipboard/share failures preserve input and remain recoverable.
- Joining twice or refreshing preserves one membership and the original data.
- Analytics is optional and accepts no personal fields; tests never touch a configured database.

## Task 1: Browser API, bounded analytics and form conversions
**Files:** `src/features/entry/{client,form-values}.ts`, `src/lib/analytics/browser.tsx`,
`src/features/backend/{analytics-http,runtime}.ts`, `src/app/api/analytics/route.ts`,
`tests/{unit/entry-values,unit/entry-client,integration/analytics}.test.ts`.
**Interfaces:** `ensureGuest(): Promise<void>`, `requestApi<T>(path,method?,body?): Promise<T>`,
`ApiError.code`; `localWindow(date,start,end): Availability`, `parseMoney(value,currency): number|null`,
`participantFromForm(fields,availability): ParticipantInput`; `trackBrowserEvent(name): void`.
- [x] Write tests for decimal precision/currencies, local/DST ranges, overlaps, API errors/session behavior and opt-in strict analytics.
- [x] Run the new tests and observe failures before implementation.
- [x] Implement helpers and analytics route with existing JSON bounds/origin handling.
- [x] Run task tests: all pass; ledger result.

## Task 2: Persistent composer, invite and participation UI
**Files:** composer; `src/features/entry/components/{create-details,availability-picker,participant-form,share-panel,invite-screen}.tsx`;
`src/app/i/[slug]/page.tsx`; globals CSS; `tests/ui/{intent-composer,participant-form,share-panel}.test.tsx`.
**Interfaces:** details creates through ensureGuest/requestApi and navigates `/i/<slug>`;
invite screen consumes `IntentView`; picker controlled `Availability[]`; participant form
accepts view/onSaved and uses POST for new, PUT for existing own participant.
- [x] Replace obsolete draft expectations with failing tests for details, creation failure retry and real navigation.
- [x] Add failing participation validation/returning-guest tests and sharing fallback tests.
- [x] Implement focused components, invite route, responsive styles and safe tracking.
- [x] Verify task UI tests and strict types; ledger result.

## Task 3: Real browser flow, review and GitHub handoff
**Files:** `tests/e2e/{server,landing.spec,invite.spec}.ts`, Playwright config, README,
CODEX_PROGRESS.md, this plan.
**Interfaces:** test server owns ephemeral DB and Next; matching origin 127.0.0.1:3100;
sets production DATABASE_URL internally and stops/cleans both on exit.
- [x] Implement isolated production-browser server and update browser tests to expect persistent flow.
- [x] Run desktop/mobile create/join/refresh/edit/duplicates, invalid/expired/revoked and long-input checks.
- [x] Run npm run check, npm run test:e2e, npm audit; inspect browser screenshots and overflow.
- [x] Obtain fresh independent review; verify necessary fixes with failing regressions then green suite.
- [x] Update README/progress/plan, inspect staged diff and secrets, commit prescribed Phase 3 message.
- [x] Fast-forward push to GitHub main, verify remote SHA and clean local status, stop.
