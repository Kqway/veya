# Closed beta readiness

Verified starting release: `b3b2dcd`. Preserve the existing Next/PostgreSQL social
and coordination domains. No new authentication provider or scheduling architecture.

## Profile deletion

Explicit `DELETE /api/social/profile` accepts only `{confirmation:"DELETE"}`.
Identity comes from the active guest binding, including suspended owners. Serialize
the guest and all affected profiles in the existing lock order, retry if membership
changes while waiting, and reauthorize before changing data. A repeated request from
an active unbound session succeeds without touching any other profile.

Erase recovery hash and bindings, push subscriptions/jobs, own notifications/events,
posts/windows/tags/candidate jobs/handles/passes, own messages and disclosures.
Close requests/matches/conversations and replace profile/pair identities with deleted
participant placeholders. Keep minimized relational tombstones; no automatic
tombstone-purge job is installed. Peer-authored history follows existing interaction
and report retention. Immutable report text/evidence
and moderator audit remain protected; deletion never cascades them away. Deleted
profiles cannot be rebound, recovered or reactivated by moderation. Their former
guest sessions retain separate coordination access, never access to the deleted
social identity.

Ordinary shared plans remain available to peers. In linked plans, erase participant
details attributable to currently bound guest sessions, anonymize organizer display,
invalidate cached proposals. Keep the inaccessible internal match-to-plan reference
so a later deletion by the other participant can erase their linked data too. Closed
match projections hide the plan link and workers skip closed matches. Ownership and bearer
invitations are separate credentials; copied or previously disclosed content cannot
be recalled. Aggregate analytics events contain only event type, surface and timestamp,
with no profile/session/content attribution; these anonymous aggregate records retain
the existing 30-day policy rather than attempting an impossible per-profile lookup.
Deleted seeking posts no longer contribute their live cohort state.
Old detached coordination sessions cannot be attributed to a social
profile without retaining additional identity history; document this limit.

## Operations

Central server-only flags pause signup, new seeking, or application mutations while
health/readiness and reads stay available. Account deletion, session revocation and
human moderation safety actions remain available during read-only maintenance.
Workers respect read-only mode. PostgreSQL remains authoritative; bounded jobs use
existing claims, leases and retries. Add safe lifecycle logs and scheduler guidance,
real isolated migration/worker/container smoke, and protected backup/restore tooling.
Never enable destructive scheduled retention without an operator-selected policy.

## UX and verification

Polish existing screens and memory-only one-time recovery key presentation. Extend
the deterministic RU/EN activity vocabulary, preserving unknown manual activities.
Use native PostgreSQL deletion/authorization/race tests, DOM confirmation/key tests,
two-person beta browser journeys through organizer confirmation, independent security
review, and fresh full local release gates. Hosted CI and actual deployment/device
verification are separate evidence. The release remains a closed beta candidate
until the owner verifies their HTTPS/database/scheduler/backup environment.
