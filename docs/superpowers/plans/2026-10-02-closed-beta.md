# Closed Beta Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for assigned tasks. Track steps below; root integrates independent domains and performs final review.

**Goal:** Prepare the existing Veya release candidate for an operated closed beta.

**Architecture:** Extend current transactional identity and projection boundaries.
Retain anonymized interaction/report references while erasing personal social data.
Reuse existing PostgreSQL jobs, environment validation and non-root deployment.

**Tech Stack:** Next.js 16, React 19, strict TypeScript, Node 24, PostgreSQL, Vitest, Playwright.

**Spec:** [closed-beta-design.md](../../closed-beta-design.md).

## Global constraints

- Preserve action-first discovery and the existing coordination loop.
- Do not edit migrations 0001–0017; start new schema changes at 0018.
- Never log/store keys, messages, credentials or private location in operational data.
- No production deployment, force push, architectural replacement or paid AI tests.

## Review focus

- Suspended owners must still be able to delete, without reactivation afterward.
- Deletion waiting on locks must not race a new match, recovery, push or message.
- Report evidence must remain immutable even when the underlying message is erased.
- Read-only maintenance must stop expensive mutations without blocking health/safety.
- Shutdown and duplicate worker runs must release resources and preserve claim ownership.

## 1. Baseline and inventory

- [x] Read mandatory documents, services, all SQL and current tests; record HEAD/hashes.
- [x] Run npm ci/check/full E2E without source changes; record actual evidence.

## 2. Deletion and operational controls

Files: new migration0018, social/deletion.ts, identity/context/http, env/beta controls,
native deletion tests and policy tests. Interface: delete(token,input) => {deleted:true}.

- [x] Add failing authorization, confirmation, idempotency, stale-key/session, protected
  evidence, linked-plan and concurrent deletion/recovery/message tests; observe RED.
- [x] Implement one transaction using sorted existing locks and bounded membership retries.
- [x] Add failing flag validation and direct-API read-only/signup/seeking tests.
- [x] Enforce policy before expensive mutation work; run affected native/unit tests GREEN.
- [x] Commit this independently testable boundary with truthful retention documentation.

## 3. Operations and onboarding

Files: scripts/workers, logging, deployment/backup tooling and docs; existing social
components/activity normalization with unit/DOM tests. Domains edited independently.

- [x] Add failing worker signal/deadline/concurrency and normalization/key/deletion UI tests.
- [x] Implement bounded shutdown, safe diagnostics, protected backup/restore and scheduler examples.
- [x] Extend RU/EN normalization and simplify existing copy; preserve strict projections.
- [x] Run relevant native/unit/DOM verification and commit logical groups.

## 4. Beta journey and review

Files: tests/e2e/beta.spec.ts, isolated container smoke, review document.

- [x] Add full two-person UI→confirmation/inbox, deletion and two-pair incognito checks.
- [x] Run desktop/mobile including320px; correct actual failures without weakening checks.
- [x] Independent read-only review; reproduce Important/Critical findings before fixes.

## 5. Release evidence

- [x] Fresh npm ci/lint/typecheck/test/build/audit/E2E; runner+operations Docker builds,
  non-root/actual DB migrations/workers/backup restore smoke; preserve old SQL hashes.
- [x] Update README/progress/checklist/deployment/security with exact counts and limitations.
- [x] Normal publication and observe exact application-source CI; no production deployment.
  Source7561967 passed hosted run37101005678 and local684/77 plus56/56 first-attempt,
  audit0 and both normal Docker/non-root/actual-PG/worker/backup-restore gates.
  The new lint advisory was fixed and independently re-reviewed without waived checks.
  The documentation-only release-evidence commit repeats CI before handoff.
- [x] Report concrete owner env/deploy/worker/device checklist.
