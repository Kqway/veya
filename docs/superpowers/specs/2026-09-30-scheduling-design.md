# Veya Phase 4: deterministic scheduling and group decisions

## Intent and scope
Complete one phase of the authorized autonomous roadmap: convert friends' saved
availability into a best match and up to three useful alternatives, explain
compromises, show group availability and allow YES/MAYBE/NO voting. No AI or
Phase 5 work. Preserve no-account entry and the existing visual style. Publish
one `phase-4: scheduling engine` commit to GitHub main by fast-forward.
This is architectural work; the autonomous instruction overrides approval pauses.

## Pure engine
Replace the unused scheduling contract with typed input/output consumed by a
server adapter. Input includes participant IDs (internal only), offset ISO windows,
category/value preferences, nullable integer minor-unit budgets/currency, explicit
from/until instants and target duration (service uses 60 minutes). No clock, SQL,
React, random values, remote calls or AI inside the engine. Normalize UTC instants,
sort identities, merge adjacent/overlapping windows and reject malformed bounds.
Limit search horizon to 30 days; never mutate input or compare currencies numerically.

Generate target-duration windows at availability boundaries/end-minus-duration and
30-minute UTC grid points. Add shorter spans between any boundaries within the
target (15–59 minutes) to capture shared periods even when other windows split
them; if nothing reaches 15 minutes, offer the
longest genuinely available shorter period rather than fabricate availability.
Attendance requires full coverage of the candidate; partial attendance is separate.
Rank lexicographically by full attendee count, then score, then earlier UTC start,
longer duration and a stable ID tie-break. Score 0–1000: attendance fraction 700,
availability quality 150 (duration/target plus flexibility), common preferences 100,
budget compatibility 50. More people always outrank a higher secondary score.
Public activity labels come only from the public structured intent. Private
preferences influence ranking but never supply public text; dietary/location preferences contribute
to overlap without inventing venues, costs or allergy compatibility.

Same-currency overlapping budget ranges are compatible; incompatible ranges or
mixed currencies are explicit compromises. Missing budgets are unknown, not zero.
Choose non-overlapping alternatives greedily, up to three; fewer when no distinct
periods exist. Zero/no future availability returns an actionable request for more
availability, not only No matches. A subset match explains X of Y can attend.

## Persistence and lifecycle
Add a new migration: opaque public suggestion key, selected suggestion FK scoped
to intent, scheduling revision and candidate fingerprint on intent. Do not modify
applied migrations. Results are generated lazily on a no-store GET under the same
intent write lock as joins/updates/votes/decision. Engine v1 replaces seed snapshots.
Fingerprint engine version, normalized participant inputs and output, excluding
the incremented scheduling revision. Identical proposals
retain keys and votes; membership changes already invalidate them and now increment
revision/reset fingerprint. Time passing also replaces proposals if their future
windows change. Any regenerated proposal set deletes old votes atomically.
Collecting -> ready when suggestions exist; no future options remains collecting.
Decided/expired snapshots are read without regenerating. Creator can confirm one
proposal; decided groups reject further joins/updates/votes and a different decision.
Repeated confirmation of the same proposal is idempotent. A collection deadline or
creator close does not erase a decided state; its saved selected key remains the
authoritative result presentation. No reopening.

Votes and decisions submit {suggestionKey,revision,...}; active guest credentials
are locked and resolved server-side. Votes derive the caller's membership; changing
YES/MAYBE/NO upserts one row per proposal/person. No membership -> forbidden. Creator
alone confirms. Reject stale revision/key with 409 STALE_RESULTS and useful reload.
Validate suggestions belong to the requested intent. Fresh results generation and
membership mutation serialize; transactions roll back partial changes and analytics.

## Privacy and API
GET `/api/intents/[slug]/results` returns IntentView plus suggestions, revision,
selected key, own vote and counts. Only valid creator/members additionally receive
other participants' display names and derived availability status at each candidate.
Anonymous/outsider reads get counts only. Never expose internal IDs, exact private
windows, notes, individual budgets/preferences, guest hashes or vote identities.
Join form explains group visibility of names/derived attendance before submission.
Detailed preferences and notes remain private. Suggestion public keys identify plans,
not people. Public budget explanations contain compatibility, never amounts.
POST `[slug]/votes` and `[slug]/decision` use existing origin/body/error boundaries.
Browser analytics adds result_viewed on result page; server vote_submitted records
only actual new/changed votes when enabled. No personal event properties.

## UI and prerequisites
Invite links to `/i/[slug]/results`, before and after joining. Result page shows
best match, alternatives, local timezone and explicit end date when it differs,
shorter duration/budget/preference explanations and aggregate/member-only availability.
Members vote with pressed states/counts; visitors get a join CTA. Creator can confirm
a proposal; everyone sees the selected plan and closed controls after confirmation.
Saving choices preserves input/errors; stale proposals offer reload. Refresh and an
explicit Refresh results action retrieve current votes/data, without polling.
No-availability state links back to entry; expired/invalid/unavailable states are useful.
Fix comma-containing preference edit with quoted CSV representation/parser and clear
hint, and overnight/24h display with local end date. These are small scoring/summary
prerequisites from the Phase 3 review, not unrelated work.

## Verification
Observe RED then GREEN for engine full/partial/no overlap, empty/single/many windows,
short ranges, preference ranking, budgets/mixed currencies, exact-boundary/timezone,
merging/input order/determinism and invalid input. Native PostgreSQL tests cover cache
stability, regeneration, stale/concurrent votes, ownership, revocation, expiry, privacy,
atomic rollback, decision freeze and opt-in analytics. UI tests exercise vote errors
and state. Desktop/mobile production browsers exercise separate guests, results,
voting/refresh, changed availability/stale choices, creator confirmation and closure.
Run lint, types, complete tests/build, browser regression suite, audit, screenshots,
one independent review, update README/progress, commit/push and stop.
