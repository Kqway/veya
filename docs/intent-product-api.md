# Minimal intent product client contract

This is the local 0019/0020 candidate, not the live 18-migration deployment.
Implementation: `src/features/intent-product/{schema,http,service,rooms}.ts`.
All routes below use `/api/intavro`, no-store JSON and current server-owned guest/profile
binding. Mutations require the exact trusted Origin and strict bounded bodies;
operational flags/rate budgets precede database/provider work. Responses use
`{error:{code,message}}`; 401/403/404/409/429/503 retain existing safe semantics.
Stateless interpretation does not create a profile, search, offer or room.

## Interpretation and owner preferences

| Method and route | Input | Response |
| --- | --- | --- |
| POST `/interpret` | `{text,timezone,referenceDate,draft?}` or `partialDraft?` (not both drafts) | `{interpretation}` |
| GET `/preferences` | — | `{preferences}` |
| PATCH `/preferences` | Full strict Preference | `{preferences}` |

Text is 1–500 characters; timezone is a validated IANA name; referenceDate is a
real `YYYY-MM-DD`. Interpretation is a strict discriminated union:
`draft` (reviewable SearchDraft/summary), `clarification` (one activity/time/city
question with at most six options and partial/complete own draft), `command`
(stop/extend) or `preference` (offers/quiet-hours/activity rule). It is advisory;
execution needs a separate explicit API action. Optional provider receives only
own text/draft, uses existing bounded transport and deterministic fallback, and
never receives candidate profiles or human messages.

Preference: `{offersEnabled,timezone,quietHours:null|{startHour,endHour},activities}`;
hours 0–23 must differ, including overnight quiet periods. Up to 12 unique activity
rules `{activityKey,attributes,enabled}`. Preference reads/writes are owner-only;
changes never silently accept offers or reveal identity. The UI reviews parsed
changes and exposes editable/removable rules at `/preferences` under «Я».

## Persisted searches and recipient offers

| Method and route | Input | Response |
| --- | --- | --- |
| GET `/searches` | — | `{searches:SearchDTO[]}` (latest 20 owner searches) |
| POST `/searches` | `{draft:SearchDraft,consent:true}` | 201 `{search}` |
| GET `/searches/:key` | — | `{search}` (owner only) |
| PATCH `/searches/:key` | `{draft:SearchDraft,consent:true}` | `{search}` |
| POST `/searches/:key/command` | `{type:'stop'}` or `{type:'extend',minutes?}` | `{search}` |
| GET `/offers` | — | `{offers:OfferDTO[]}` (latest 30 recipient offers) |
| GET `/offers/:key` | — | `{offer}` (recipient only) |
| POST `/offers/:key/respond` | `{action:'accept'|'decline'}` | `{offer}` |

SearchDraft: `{seeking,neededPeople,existingPeople,attributes,timezone}`; `seeking`
reuses the bounded strict social seeking input. Capacity is existing + needed,
2–12; existingPeople includes the owner, so existing−1 seats are explicit external
reservations. One-to-one capacity must equal two; groupSize must agree if supplied.
Future windows and expiry are revalidated server-side, expiry at most 30 days.
Attributes are activity-specific strict schemas: dota2 role/rank/minRank/mode enums,
gym trainingType/experience, study bounded subject/level, movies bounded movie;
other activities accept an empty attribute object. Extension is 1–1440 minutes.

SearchDTO: `{publicKey,activityLabel,status,neededPeople,existingPeople,capacity,
joinedCount,compatibleCount,offeredCount,acceptedCount,roomKey,createdAt,expiresAt,
timeHint,ownDraft?}`. Search statuses: active/filled/closed/expired. Counters reflect
persisted records in a bounded pool; joinedCount includes external seats and is not
a count of independently verified Intavro members.

OfferDTO: `{publicKey,activityLabel,status,neededPeople,timeHint,attributes,
expiresAt,roomKey}`. Status: pending/accepted/declined/expired/cancelled. No sender/
candidate identities, global profile IDs, raw text, precise windows or exact location.
Offer expiry is at most 24 hours and bounded by search expiry/future overlap.

Create atomically saves the seeking post/search/lobby/owner membership/durable job.
Explicit Start authorizes compatible offers; immediate bounded best-effort processing
is followed by durable scheduled retries/future-candidate processing. Eligible
recipients need active compatible posts, current permissions, no mutual block and
permitted preferences. Pool ≤100 posts, ≤5 offers per processing batch, ≤10 pending
per search. Revision dedupe is `(search,recipient,source_revision)`, with at most one
pending search/recipient offer. A cancelled old revision permits a fresh offer;
actual declines remain remembered. Search updates cancel old pending offers and
advance revision; updates after any acceptance fail 409. Stop never destroys an
already-created room. Accepted repeats are idempotent only while membership is valid.

## Consent, rooms and original planning

| Method and route | Input | Response |
| --- | --- | --- |
| GET `/rooms` | — | `{rooms:RoomDTO[]}` (latest 20 membership contexts) |
| GET `/rooms/:key` | — | `{room}` |
| GET `/rooms/:key/messages` | `before?`, `limit?` 1–50, default 30 | `{messages,nextBefore}` |
| POST `/rooms/:key/messages` | `{text}` 1–2000 plain-text characters | 201 `{message}` |
| POST `/rooms/:key/state` | `{status:'active'|'completed'|'archived'}` | `{room}` |
| POST `/rooms/:key/remove` | `{memberKey}` | `{room}` |
| POST `/rooms/:key/block` | `{memberKey}` | `{blocked:true}` |
| POST `/rooms/:key/report` | `{memberKey,reason,text?}` | `{reported:true}` |
| POST `/rooms/:key/plan` | `{}` | `{slug}` (ordinary `/i/:slug`) |

A room is created only when consenting registered memberships plus declared external
reservations fill capacity. Sorted profile locks then search/lobby locks, post-wait
reauthorization and database constraints protect last-slot races and blocks/deletion.
Every room/message action verifies current context authority; possession of a room
key or another room's message cursor does not confer access.

RoomDTO: `{publicKey,activityLabel,status,capacity,joinedCount,externalCount,isOwner,
members:[{publicKey,alias,avatarSeed,isMine}],planSlug}`. Member keys are scoped opaque
handles, never global profile IDs. Incognito identities are random persisted per
room, independent of pair/global presentation. MessageDTO:
`{publicKey,text,createdAt,isMine,identity:{alias,avatarSeed}}`.

Room state starts ready, then active/completed/archived; unsafe contact can become
closed. Owner controls normal state transitions. Current member may remove self;
only owner removes others. Leave/removal closes the room and invalidates removed
member authority. Completed/archived rooms leave the active UI, with bounded authorized
history; completion is an owner declaration, not verified attendance.

Report reasons retain spam/harassment/unsafe_meeting/impersonation/other; optional
text ≤1000. Existing `social_reports.room_id` stores the context and immutable
minimized moderator evidence (reporter/target messages only, bounded latest 20).
There is no separate room-report table or AI moderator. Blocking closes contact
across rooms and legacy pair flows. Protected reports survive personal-content erasure.

Plan it creates/reuses one ordinary plan, using only safe activity/alias data.
Availability is manually entered; original scheduling/results/votes/confirmation
stay unchanged. A copied plan is a bearer invitation. Recovery does not transfer
original coordination guest ownership; server-proven historical linked-plan binding
records let later deletion erase recovered/previous-session linked aliases and
participation. They cannot prove associations detached before this migration.

Realtime adds fixed `intents` and `rooms` topics, with no search/offer/room IDs or
content in those invalidations. Persistent APIs remain authoritative. Notifications
add OFFER_RECEIVED/LOBBY_READY/ROOM_MESSAGE with authorized local links. Opt-in push
stays generic. Frequent configured workers are required; daily Hobby Cron is not
adequate for timely short-lived offers. Cleanup remains explicit preview/apply:
room reports require resolved/dismissed status and both timestamps older than 365
days; inactive contexts use 180-day guards and terminal intent jobs seven days.

## Aggregate reporting

Optional fixed transition events remain content/identifier-free.
`npm run analytics:funnel -- 7` retains the legacy seeking report and adds `actions`:
`{days,searches,candidates,offered,accepted,rooms,conversations,plans,confirmed,completed}`.
Each count is the number of searches in the 1–30-day creation cohort reaching that
stored condition, not total offers/messages or unique people. Completion is an
owner declaration. Deletion/retention can lower historical counts; the report is a
current relational snapshot, not an immutable lifetime audit.
