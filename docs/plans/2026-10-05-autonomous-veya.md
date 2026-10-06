# Autonomous Veya Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Execute all phases under the user's supplied brief;
> do not stop after documentation or ask to reauthorize implementation.

**Goal:** Turn Veya into a durable goal execution product with an honest complete
mock earn-money journey and a completely redesigned primary interface.

**Architecture:** Separate goal domain in the current Next/PostgreSQL application.
Typed interpreter/planner/registry and policy, persistent leased execution, mock
connectors and artifact storage. Existing Intent Network becomes an adapter.

**Tech Stack:** Next16/React19/TypeScript strict/Zod4/pg/Vitest/Playwright.

**Spec:** `docs/autonomous-goal-engine-design.md`, `docs/veya-redesign-system.md`.

## Global Constraints

- Never edit migrations0001–0020; only0021+.
- No external services are connected or paid actions claimed. UI labels demo.
- PostgreSQL authoritative; browser requests never execute a goal.
- Existing guest/profile privacy, moderation, deletion and recovery stay valid.
- All external actions require evidence and idempotency, payments exact matching
  amount/currency/invoice and provider event dedupe. No arbitrary tools.
- No dependency necessary for new domain; preserve strict types and bounded JSON.

## Review Focus

- Stale leases/lock waits must not commit duplicate tool effects.
- Owner deletion/moderation/disabled connectors must stop execution after waits.
- Payment currency/amount mismatch and duplicate events must not inflate success.
- Approval must bind immutable exact action; denial/cancel cannot resume writes.
- Narrow mobile and legacy CSS must not break new shell or existing invite actions.

### Task 1: Goal domain and mock execution

Files: create `db/migrations/0021_agent_goals.sql`,
`src/features/goals/{schema,interpreter,state,planner,policy,tools,connectors,storage,repository,service,worker,http,runtime}.ts`,
`scripts/agent-worker.ts`, `src/app/api/agent/[...path]/route.ts`.
Modify social deletion, notifications/realtime, existing worker/cron and scripts.
Tests: `tests/unit/goals.test.ts`, `tests/integration/goals.test.ts`,
`tests/integration/goals-http.test.ts`.

Public interfaces: `GoalService(db).create(token,{text,environment:'demo'})`,
`list(token)`, `get(token,key)`, `command(token,key,{type:'pause'|'resume'|'cancel'})`,
`approve(token,goalKey,approvalKey,{decision:'approve'|'decline'})`,
`connections(token)`, `setConnection(token,{enabled:boolean})`,
`policy(token)`, `savePolicy(token,{communicationLimit:number})`,
`artifact(token,goalKey,artifactKey)`, `activity(token)`.
`processGoalJobs(db,{limit?,signal?})` returns claimed/completed/retried/failed.
DTOs match design; schema exports GoalDTO, GoalStatus, GoalSpec, GoalEventDTO,
GoalArtifactDTO, GoalApprovalDTO, ConnectionDTO, AutonomyPolicy.
HTTP `/api/agent/goals`, `/goals/:key`, `/goals/:key/command`,
`/goals/:key/approvals/:key`, `/goals/:key/artifacts/:key`, `/connections`,
`/policy`, `/activity`. Read/no-store, mutations same-origin, existing limiter.

- [x] Write tests proving Goal parsing, rolling plan, evidence/policy validation,
  integer money, terminal transitions and risk bounds; run and observe RED.
- [x] Implement strict pure schema/interpreter/planner/state/policy/registry and
  typed connector/storage/payment/external-agent contracts; run unit GREEN.
- [x] Write native DB tests proving10,000 RUB completion through proposal/client/
  stored verified artifact/delivery/invoice approval/confirmed payment; run RED.
- [x] Implement additive constrained schema, transactional mock connector effects,
  durable worker/service and scoped DTOs; rerun native tests GREEN.
- [x] Add native races/retry/crash/lease nonce/duplicate action+webhook, approval
  rejection/expiry, connector disable, cancellation, deletion and authorization.
- [x] Implement and test same-origin/beta/rate/body protections, authenticated
  artifact content and verified event ingestion, CLI batch/watch with AbortSignal.
- [x] Integrate fixed goals realtime and significant existing notifications,
  profile erasure, retention preview, social worker/cron. Preserve historical
 18→20 console release via first20 migrations rather than modifying old SQL.
- [x] Run focused native/unit HTTP tests and typecheck; record results.

### Task 2: Completely redesigned primary frontend

Files: new `src/features/goals/components/*`, `src/features/goals/goals.css`,
new goals/activity/settings/autonomy/network routes; update app home/layout,
brand/navigation, connections/profile metadata and open graph image.
Tests: `tests/ui/goals.test.tsx`, `tests/e2e/goals.spec.ts`.
Consumes Task1 public schema and `/api/agent` contracts. Uses existing ensureGuest,
social identity/recovery provider, requestApi and goals realtime invalidation.

- [x] Write failing user-behavior UI tests for composer/demo/empty/error/approval.
- [x] Implement reusable primitives and tokens, new shell, responsive composer,
  goal cards/detail timeline/status/progress/next actions/artifact/controls.
- [x] Add approval route, Activity, Connections controls, saved bounded Autonomy,
  Settings/profile identity/privacy/recovery/notification links and safe deletion.
- [x] Move former root and social connections to secondary network routes;
  update intentional old browser route expectations while preserving domain tests.
- [x] Run UI tests, lint and typecheck, then inspect main and legacy surfaces.

### Task 3: Intent Network capability and hardening

Files: `src/features/goals/intent-network-adapter.ts`, AI provider/task extensions
if required by typed planning, retention integration, README/CODEX_PROGRESS.
Tests: unit/integration adapter and security cases, browser completed/approval flows.

- [x] Wrap existing authorized discovery as registered search_people/match_intent,
  using owned source keys and existing privacy/permission filters; no global IDs.
- [x] Verify typed AI output cannot select arbitrary tools or establish evidence;
  untrusted connector content cannot alter policy or bounded deterministic state.
- [x] Run complete lint/typecheck/test/build. Fix actual regressions and record
  any environment limitations accurately; keep original migration hashes intact.
- [x] Run production Playwright demo completion/reopen/approval plus legacy E2E;
  inspect desktop/mobile/screenshots for empty/active/completed/wait/error/settings/
  connections/autonomy and320/375/390/tablet/reduced motion. Repair visual failures.
- [x] Obtain read-only whole-change review; fix actionable findings and verify.
- [x] Update docs with actual evidence and operations. Leave a reviewable branch
  and report delivered behavior plus real connector/deployment limitations.
