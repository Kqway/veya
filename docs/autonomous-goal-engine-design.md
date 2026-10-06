# Veya — Autonomous Goal Network

Date: 2026-10-05. This design implements the supplied product brief in the existing
Next.js/PostgreSQL repository. The authorized outcome is implementation, including
the complete mock money journey and visual verification, not documentation alone.

## Architecture audit

The existing application has three distinct domains: bearer invitation scheduling,
private Intent Network, and temporary social action searches/rooms. Scheduling has
its own guest ownership; social identity uses server-owned guest/profile bindings,
hashed recovery keys, sorted profile advisory locks and post-wait reauthorization.
The 0020 action search requires a seeking post, bounded future availability and a
2–12 person lobby. It cannot represent a durable desired state of the world.

Reuse Database/DatabaseExecutor transactions, pg parameter binding, server-only
runtime configuration, requireProfile/lockProfiles/reauthorize, opaque keys,
bounded same-origin HTTP handlers, shared request limiting, leased workers,
recipient-scoped realtime invalidations and notification delivery. Retain pure
discovery/privacy projections and original scheduling APIs. Do not change SQL
0001–0020. Profile deletion tombstones rather than removes its row, so explicitly
erase goal content/jobs and stored artifacts; a cascade alone is insufficient.
Moderation, connector disable and cancellation must be rechecked at execution.

Alternatives considered: extending social searches mixes temporary rooms with
long-lived execution; a separate orchestrator service adds distributed consistency
and operational cost. A separate goal domain inside the existing application
preserves authoritative transactions and allows future real connector adapters.

## Domain and public contract

Goal states: DRAFT, PLANNING, ACTIVE, WAITING_EXTERNAL, WAITING_APPROVAL, PAUSED,
COMPLETED, FAILED, CANCELLED. All state transitions are validated; terminal goals
cannot restart. A GoalSpec has type, target amount in integer minor units/currency,
success criteria, bounded constraints (zero default spend), needs, offers and
valueExchange. Only confirmed matching-currency provider payment events count.
An unsupported intent is saved and honestly blocked for missing capabilities;
it is never reported complete because a plan was generated.

Owner-facing GoalDTO: publicKey, title, rawText, status, environment (demo), spec,
confirmedAmountMinor, currency, currentAction, nextActions, createdAt, updatedAt,
events, artifacts, approvals, deals, failureCode. Child DTOs contain only public
keys, bounded human-readable descriptions and evidence references, never profile
UUIDs, credentials, private candidate fields or hidden reasoning. Lists bounded
to 30 goals; detail histories bounded to 100 items. Artifact content is fetched
through an authenticated goal-scoped API, not a public filesystem URL.

## Execution

Interpreter → rolling planner → next 1–5 typed steps → tool registry → policy →
connector → validated observation/evidence → committed state → replan.
Use a deterministic local interpreter and planner for the supported demo, with
the existing structured AI provider boundary supporting bounded proposals. AI
may propose registered actions, never establish action evidence or payment.
External messages/descriptions are untrusted data; no dynamic eval, SQL, shell,
credential reads or arbitrary network URL tools exist.

SQL 0021 adds goals, runs/jobs, steps/tool calls, approvals, events, opportunities,
proposals/conversations/deals, artifacts, connector accounts, autonomy preferences
and payment events with FKs, state/bounds checks, indexes, RLS, ownership constraints,
timestamps, leases, failure codes and dedupe keys. SQL 0022 adds search_people and
bounded artifact kind/metadata. Steps/events are persisted at
each completed boundary; a new planner decision is based on persisted observation.
Provider actions require stable idempotency keys. Real connector adapters must
support idempotency or reconciliation before registration for write actions.

Worker claims a bounded batch using FOR UPDATE SKIP LOCKED, five-minute leases
and nonce ownership, five attempts with bounded exponential retry. Acquire profile
locks before goal/run locks and recheck nonce/expiry and active owner after waits.
Do not hold a database transaction across real external network I/O; the mock
adapter is local and transactional, so rollback rolls back its evidence as well.
Aborted/unstarted claims are released; stale leases cannot commit effects.
One tick advances one bounded step; WAITING_EXTERNAL sleeps until its persisted
deadline or a verified external event. No browser request runs the engine.

`npm run agent:process` processes one batch; `--watch` runs a graceful, abortable
loop for local durable execution. Existing protected cron/social worker may also
advance goals. A server deployment needs an actual frequent worker or scheduler;
closing the browser is safe, stopping all workers delays execution.

## Honest mock money slice

MockOpportunityConnector searches a bounded catalog of document/research work,
reads requirements, sends an idempotent proposal, waits for MockClient acceptance,
creates a real stored deliverable, deterministically checks every requirement,
submits it, handles revision feedback, creates an invoice, waits for delivery
acceptance and MockPaymentProvider confirmation. Repeat deals until confirmed
received amount reaches target. Opportunities, proposals, conversations, work,
delivery and payment have distinct persisted records/states. Payment is simulated;
the entire product marks this environment prominently as a demo.

MockArtifactStorage implements the same storage contract as a persistent local
filesystem store. Store content outside PostgreSQL, addressed by SHA256; persist
only metadata/reference/checksum/producing step. Restarts recover persisted content.
Verification checks required sections/content bounds and checksum; code artifacts
require a sandboxed deterministic lint/type/test/build adapter before delivery.
Do not claim support for autonomous executable code work without that adapter.

## Permission and event boundaries

READ and REVERSIBLE auto. EXTERNAL_COMMUNICATION defaults to 5/day, hard maximum
10/day across all goals of an owner. Consent permits only connector-bound actions.
FINANCIAL, LEGAL and DESTRUCTIVE always require an approval bound to exact step,
input and revision; approving one never approves unrelated actions. Invoice creation
is treated conservatively as financial even in demo. Approval denial pauses the
goal; expiry and changed input invalidate approval. Expired sleeping invoice
requests wake to issue a new exact approval without executing the financial tool. No financial spend tool ships.
Communication allowance may be saved within its bound; high risk cannot be made
unlimited through an “always allow” control.

Authenticated owner connector controls support disable, which blocks subsequent
tools after lock/recheck. GitHub/email/calendar appear unavailable until real
adapters and authorization are implemented; do not fabricate OAuth status or retain
plaintext credentials. Payment webhook adapters authenticate signatures before
DB work, bind invoice/deal/currency/amount and dedupe provider event ID. Demo events
have server-owned authority; browsers cannot self-confirm arbitrary payments.

Notifications extend existing infrastructure only for result, approval, blocker or
important change. Realtime adds fixed `goals` invalidation without keys/content.
Reads remain authoritative; reconnect/focus reload persisted state. Notifications
are generic for push. Explicit retention preview/apply deletes bounded terminal
goals older than 180 days and cleans associated stored artifacts; no automatic
destructive cleanup. Future need/offer matching and external-agent protocols have
typed interfaces, but no unverified marketplace or agent network is advertised.

## Verification

Unit: parsing currencies/amounts, state transitions, rolling output validation,
registry schemas/evidence, risk policy, approvals, retries and confirmed success.
Native PostgreSQL: creation/ownership, durable replay, expired/stale leases,
concurrent workers, duplicate actions/events, approval pause/resume, revisions,
disable/cancel/deletion/moderation, retry and rollback. Browser: new empty composer,
complete 10,000 RUB demo, approval resume, persisted state after browser reopen,
waiting/error/loading, authenticated artifacts, settings/connections/autonomy,
320/375/390/tablet/desktop overflow and reduced motion. Preserve legacy domain tests;
update route expectations where primary UX intentionally moved to `/network`.

## Intent Network capability

`search_people` is a typed READ tool with its own lock context. Person goals are
interpreted conservatively as photography/design/chess needs and select only an
owner's existing active post for that activity. Missing posts produce SEEKING_REQUIRED.
The shared discovery operation acquires all profile locks in sorted order before
goal/job locks, then validates the persisted owner grant, nonce, lease, moderation
and seek permission. It reuses real compatibility, mutual blocks, discovery budgets,
pair identity and explicit privacy projections. Persist only projected cards as
step evidence. A match produces INTERACTION_REQUIRED; it cannot claim a completed
hire, agreement or deliverable. Resuming performs another bounded search.

## Verified review corrections

Successful deadline/budget waits reset failure attempts; increasing the communication
allowance wakes the delayed goal. Erasure failures remain queued after committed
profile deletion. Authorization loss clears cached goal details, and Settings
unmounts old identity forms before focus/profile-change reauthorization. Onboarding
retries re-read the committed profile rather than creating another identity.
