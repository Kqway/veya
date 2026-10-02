# Closed beta security and privacy review

Reviewed 2026-10-02 against baseline `b3b2dcd`, including the closed beta working
diff and newly added files. This is an independent source review with targeted
native PostgreSQL and unit verification, not an external penetration test or a
production deployment certification. The reviewer made no application/test edits.

## Findings and disposition

Two Important findings were identified in the initial independent review. Both
were corrected by the implementer and re-reviewed independently. No unresolved
Critical or Important finding remains in the reviewed scope.

### Important: stateful GET requests bypassed read-only maintenance

The initial HTTP policy classified all GET requests as reads. Discovery creates
pair identities and handles and records discovery state; scheduling results can
replace proposals, remove their votes and advance the revision; connection-list
reads can expire requests. `BETA_READ_ONLY=true` therefore still allowed domain
mutations through these endpoints.

The correction treats discovery as a mutation, so maintenance rejects it before
database/provider work. Result reads load existing proposals and people without
running proposal generation. Connection reads skip request-expiry writes. Explicit
safety operations remain writable by design, and admission quotas remain active.
This is an application maintenance control, not a PostgreSQL read-only transaction
or an immutable-database guarantee.

Evidence: reviewed `social/http.ts`, `social/connections.ts`, `backend/http.ts`,
`backend/service.ts`, and `backend/results-service.ts`. Native regression coverage
in `tests/integration/beta-controls.test.ts` checks uncached/cached results, unchanged
revision, rejected voting, blocked discovery, unchanged request status, and safety exceptions.
The corrected tests passed in the independent verification below.

### Important: first profile deletion lost the later owner's plan-erasure reference

The initial deletion transaction cleared `social_matches.plan_intent_id` after
erasing the first owner's linked-plan participation. When the other owner later
deleted their profile, the transaction could no longer locate that shared plan,
leaving their participant details and availability behind.

The correction retains the internal foreign key on the closed match. Closed match
DTOs continue to return `planSlug:null`, and closed matches cannot create/reopen
plans or generate reminders. The retained reference allows the second owner's
deletion to erase their attributable participation too. Ordinary bearer invitation
access and independent coordination ownership remain separate credentials.

Evidence: reviewed `social/deletion.ts`, `social/conversations.ts`,
`social/planning.ts`, and notification reminder queries. The native regression
`erases the second participant linked-plan details after the first profile has
been deleted` passed in the independent verification below.

## Reviewed boundaries

- Deletion requires the exact strict confirmation payload and an active
  server-owned guest binding; no client-selected profile identifier is accepted.
  Guest/profile locks, sorted peer locks, membership retries and post-wait
  reauthorization serialize recovery, deletion and social writes. Suspended owners
  may delete. Repeated deletion of an already unbound active session is harmless.
- Migration 0018 minimizes deleted profiles and forbids restoration/rebinding.
  Key hashes and bindings disappear; messages/disclosures authored by the deleted
  profile are erased; requests/matches/conversations close; pair identities become
  deleted-participant placeholders with independent replacement avatar seeds.
  Own posts, windows, tags, handles, candidate work, subscriptions and delivery jobs
  are removed directly or through reviewed foreign-key cascades.
- Report-time evidence and report text remain immutable; identity tombstones avoid
  the report cascades that physical profile removal would invoke. Moderator case
  review remains possible, while profile capability/reactivation changes reject
  deleted targets. Existing retention protects open/reviewing cases and their
  context. Audit history has its own explicit operator retention requirement.
- Incognito projections remain pair-specific and explicit. No new public profile
  identifiers, candidate raw text, exact location/windows, recovery secrets or
  global identity lookup were added. Recovery keys remain in memory, with copy,
  saved/discard acknowledgement and deletion clearing the displayed key.
- Realtime invalidations contain safe topics rather than private content; deleted
  sessions lose subsequent social authorization. Push delivery rechecks session,
  binding, visibility and lease ownership after locks. Generic push already
  accepted by a provider cannot be recalled.
- Worker claims remain bounded, deduplicated and lease-owned. Abort handling stops
  new jobs and releases still-owned unstarted claims without spending an attempt.
  Work/cleanup deadlines bound CLI shutdown; forced interruption leaves current
  leases for recovery. Provider acceptance before a failed commit can still cause
  a duplicate generic push, as documented.
- Operational logging accepts fixed event names and numeric fields, excluding
  raw exceptions, credentials, private content and identifiers. Status output uses
  aggregate queue state, which does not establish scheduler health when idle.
- Backup publication uses an owner-only temporary archive, archive validation and
  atomic no-clobber linking. Restore requires a named service, refuses a populated
  destination and runs in one transaction without original ownership/grants. The
  operator must select an isolated target and stop its writers; the empty-target
  preflight alone cannot prove the configured service is the intended database.
- Reviewed migrations 0001–0018, rate admission, retention, Origin checks, cookie
  access, production origin/TLS validation, new onboarding copy, activity
  normalization, CLI/container workflow and deployment/checklist documentation.
  Applied migrations 0001–0017 have no diff from `b3b2dcd`.

## Independent verification

On 2026-10-02 at 14:39 UTC, the following command passed with **24 tests / 4 files**
in 4.38 seconds, including isolated native PostgreSQL integration tests:

```sh
npx vitest run tests/integration/social-deletion.test.ts \
  tests/integration/beta-controls.test.ts \
  tests/unit/operation-lifecycle.test.ts tests/unit/backup-tooling.test.ts
```

The reviewer also confirmed an empty `git diff b3b2dcd` for migrations 0001–0017.
Full clean-install/lint/type/build/audit/browser/container gates and exact hosted
CI evidence are recorded separately in `CODEX_PROGRESS.md`; they are not implied
by the targeted review run. Browser test source was inspected, but the reviewer
did not independently execute the complete browser/container suite.

## Remaining production limits

Deletion cannot recall screenshots, copied messages, disclosed contacts, browser
state on another device, already accepted push, or bearer invitations already
shared. Peer-authored history and protected moderation evidence may remain.
Coordination details belonging to old guest sessions detached by recovery cannot
be attributed to the deleted social profile without additional identity history.
The retained internal linked-plan reference is inaccessible through closed social
DTOs and follows the existing context/plan retention policy.

The release owner must verify real HTTPS/cookies, database certificates and roles,
proxy SSE delivery, scheduler health, encrypted off-host backup restoration,
retention policy, human moderation response, actual mobile/Safari behavior and
optional real push delivery before inviting users. This review does not claim
those production checks were performed, absolute anonymity, verified human
identity, or elimination of multi-guest abuse.

## Controller browser verification follow-up

The new 320px reduced-motion journey reproduced continuous 1px button movement:
a touch-emulated hover state alternated the existing hover transform, preventing a
normal click. The correction confines the hover transform to hover-capable fine
pointers. The browser assertion remains a normal click; no forced action or relaxed
privacy/authorization assertion was introduced. Final browser results are recorded
in CODEX_PROGRESS.md.

The full browser gate also exposed missed preset clicks while global smooth scrolling
was moving form controls: the selected-time list remained unchanged and submission
correctly rejected missing availability. Form/document scrolling now settles
immediately. The custom-range test explicitly verifies the first selected interval
before attempting an overlap; its overlap and persisted-UTC assertions remain intact.
Final gates execute without concurrent browser/container builds to avoid resource
contention in the managed workspace.

Final reviewer follow-up at `75a4ee6` found no new Critical/Important issue in the
CSS/cold-start/copy/test changes. Implementer full verification remains separate:
673 tests/76 files and 54/54 desktop/mobile E2E, with no retries.

## Hosted browser transport follow-up

At `6f1f0ed`, hosted container/database gates passed; one desktop browser journey
failed because the test auditor's upstream `route.fetch` received ECONNRESET.
The failure trace established a transport error before response projection, then
a second attempt encountered compatible posts left by the first attempt.
No application authorization or blocking failure was demonstrated by this trace.

A real local HTTP socket-reset regression first failed with the original auditor,
then passed with exactly one GET-only ECONNRESET retry; POST is asserted to make
exactly one attempt. HTTP error responses are not retried. Disjoint future windows
isolate retry/repeat fixtures while retaining real chess/Moscow/language matching,
exactly one candidate and all privacy/UTC/block assertions. An independent read-only
follow-up found no new Critical/Important issue in these infrastructure changes or
the operations-container reuse; concurrent worker processes/pools and unchanged
database assertions were checked. The controller also restricted the transport
fixture to its resource endpoint so unrelated browser requests cannot alter counts.
Full final application and hosted evidence is recorded separately in CODEX_PROGRESS.md.

## Production quota and deletion UI follow-up

The strict hosted gate at `d9b6e0a` failed with 55 browser cases passing: its trace
showed HTTP429/Retry-After5 on own-seeking and unread reads. Parallel independent
journeys exhausted the real shared global read quota; production budgets and
fail-closed enforcement were correct. Browser journeys now run serially while
simultaneous actors within realtime cases and independent database worker processes
remain concurrent. No production quota was increased or bypassed.

Two UI regressions reproduced failed own-post loading being presented as an empty
list (HTTP429 and503). Discovery now distinguishes unloaded/error state and offers
an explicit Retry activities action, without automatic polling or sending interest.
Independent review then found a P2 race: a delayed retry profile response could
restore the displayed identity after successful deletion. A deferred-response test
reproduced that failure before correction. Generation checks now ignore obsolete
profile/post/candidate responses and action completions/errors after profile changes.
All five new cases passed within the 26-case UI suite. Independent read-only
re-review confirmed the fix and found no additional Important/Critical issue.

The restore procedure explicitly documents that historical backups can restore
previously deleted content or revoked credentials. There is no external automatic
deletion/revocation journal. Reconciliation or verified point-in-time recovery is an
operator requirement before promotion; uncertain restored data must stay isolated.
Encrypted backups retain old content until their documented bounded expiry.

A subsequent full local browser run reproduced a separate foreground/background
race: the realtime discovery read toggled the foreground busy/Working state while
Interested was being clicked. The trace contained the GET but no connection POST.
The failed run was preserved, not accepted as a release pass. A deferred-background
UI regression reproduced disabled Interested before correction. Live discovery now
uses a separate bounded read lock, leaving foreground controls stable; manual work
and selection changes invalidate older background generations. The test verifies
exactly one explicit request and no resurrection from a stale candidate response.
Targeted UI verification passed27/27; independent read-only re-review confirmed
bounded refresh scheduling, mounted guards and unchanged authorization/privacy/quota
boundaries, with no new Important/Critical issue. Final full-gate evidence follows
in CODEX_PROGRESS.md.

The next complete run found the same busy-lock race in the other two foreground
screens: local mobile Accept had no POST while its background connections read ran;
hosted mobile Send clicked without a corresponding message POST. Both complete
runs finished55/56 and were rejected as release evidence. Two more deferred-read
regressions reproduced RED, then passed with the same bounded foreground/background
separation in Connections and Match. Manual actions and successful blocks invalidate
stale pending-request lists, match snapshots, message pages and pagination updates.
Targeted UI29/29 passed; independent read-only review checked accepted state, sent
messages, block closure, pagination, mounted guards and one background refresh per
component, with no new Important/Critical finding. Server authorization, projection
and production quotas remain unchanged.

The final observability check found LISTEN reconnect exhaustion had no fixed
operational log. Its existing bounded-retry test was extended without removing any
assertions: missing logging reproduced RED; the hub now emits one allowlisted
realtime_unavailable event with only numeric attempts at exhausted recovery. Normal
shutdown emits no extra failure, and no URL/credentials/profile/error content is
logged. Hub/API-logging targeted5/5 passed; independent read-only review confirmed
unchanged retry timing, authorization and subscriber cleanup.
