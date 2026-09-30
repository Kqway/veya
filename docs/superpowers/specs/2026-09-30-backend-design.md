# Veya Phase 2: persistent backend

## Scope

Complete Phase 2 only, incrementally on verified Phase 1. Build PostgreSQL models,
migrations, validated data access, guest sessions, authorization, seed/demo data
and backend integration tests. The existing landing remains a local preview;
connecting it and building invite/join UI is Phase 3. Autonomous execution is
already authorized by the user's roadmap and continuation request.

## Persistence

Extend the existing pg boundary with pinned-client transactions. Versioned SQL
migrations run atomically under a PostgreSQL advisory lock, record checksums and
reject changed applied migrations. Use UUID identities, timestamptz, foreign keys,
CHECK constraints, unique guest membership, and indexes for common lookups.

Tables: users, guest_participant_sessions, intents, participants,
availability_windows, preferences, plan_suggestions, votes, analytics_events.
Intent supports collecting/ready/decided/expired, raw/title/structured text,
nullable user/guest creator keys (exactly one), public slug and expiration.
Participants similarly have one user/guest identity. Composite vote foreign keys
prevent votes crossing groups. Budgets use integer minor units and explicit
currency. Windows store unambiguous instants. No AI/scheduling algorithm yet.

## Guest authorization and privacy

Generate 256-bit guest tokens, store SHA-256 hashes only, expire after 30 days and
support revocation. HTTP transport uses an HttpOnly, SameSite=Lax cookie with
Secure in production. Resolve the token on every authorized operation; never
accept a creator/session/participant ID in request bodies. Public invite slugs
carry 144 bits of entropy. Public reads expose intent details and participant
count; only the current guest receives their own budget, note, preferences and
availability. Never expose user emails, session hashes or internal IDs.

Create intent, public/own read, idempotent join, own-participant update, owner-only
close and session revocation are backend operations. Lock the intent in write
transactions; unique membership handles duplicate submissions. Expired invites
report effective expired status and reject changes. Decided plans reject joins
and edits. Participant changes invalidate stored suggestions/votes and reset a
ready intent to collecting; recomputation belongs to Phase 4.

## Validation and HTTP

Strict Zod schemas reject unknown ownership fields. Bound text, arrays, budgets
and availability; require ISO timestamps with offsets, ordered non-overlapping
windows within the upcoming 30 days, and ordered budgets with currency. JSON
requests are limited to 16 KiB and same-origin mutations are required. Return
stable safe error codes and no-store responses. Database failures return a
generic service-unavailable error without driver details.

API routes cover session creation/revocation, intent creation/read/close and own
membership creation/update. No public mutation of suggestions/votes yet.
Analytics remains disabled by default; a PostgreSQL adapter persists the existing
safe event contract when enabled, with no personal text.

## Local workflow and verification

Use an npm-distributed embedded native PostgreSQL dev dependency for ephemeral
integration tests and optional persistent localhost development. This is a real
PostgreSQL server; production still uses pg and an external PostgreSQL URI.
Provide db:local, db:migrate and idempotent db:seed commands. Seed one demo intent
with several participants/windows/preferences, suggestions/votes and a safe
analytics event; never use predictable demo bearer tokens or production data.

Tests exercise migrations/checksums, SQL constraints, transaction rollback,
session hash/expiry/revocation, authorization, private projections, duplicate and
concurrent joins, validation, expiry/state rules, seed idempotence and HTTP
cookies/origin/body/error behavior. Run lint, types, full unit/UI/integration
suite, production build and existing browser checks, obtain an independent
review, update persistent progress, commit phase-2: backend and data model, stop.
