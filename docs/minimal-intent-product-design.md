# Minimal intent product — Intavro

## Scope and continuity

Owner requests conversational intent-first action orchestration on the current
Next.js/PostgreSQL application, not an AI messenger or profile directory. Preserve
all existing guest/social identity, Incognito pairs, recovery, privacy projections,
moderation, deletion, notification workers, SSE, deterministic matching and plans.
Profile Worlds0019 remains additive and is completed alongside this stage.
The main interaction becomes a short phrase, a bounded interpretation, at most one
question at a time if critical data is missing, explicit Start, persisted search,
actionable compatible offers, consent, and a temporary action room.

## Assistant vs human room

Assistant is a stateless bounded text-to-command translator plus visible persistent
settings/search state. It never sees candidate profiles or human messages. Structured
commands are validated twice, then executed by server-authoritative domain services.
No autonomous disclosure/block/accept or invented personality. Deterministic local
parser and manual settings work without OpenAI. The existing provider abstraction
supplies optional own-text reformulation under its 8s/1000-token/no-retry/fallback bounds.
Deterministic checks preserve already understood facts and reject new numbers or
commands; the original user's text remains the saved source.
Human rooms contain plain-text messages only and exist after offer acceptance. They
are tied to a particular action; no followers, directory, feed, popularity or ads.

## Schema and compatibility

After0019 add0020_intent_lobbies.sql. Intents here are social_action_searches linked
1:1 to existing seeking_posts (ordinary scheduling intents stay unchanged). Common
fields activity/mode/city/windows/skill/languages/tags reuse SeekingService and the
pure matching engine. Add strict bounded activity-specific JSON attributes and
neededPeople/existingPeople/capacity (max12). Dota's 'need a fifth' means owner says
four already in their team: three EXTERNAL reserved seats plus owner, one new slot.
Those seats are an explicit owner declaration, never fabricated Intavro members;
room lists only registered consenting members and labels the external count.
No global profile UUID or ranking fingerprint in DTOs.

Tables: social_action_searches, social_lobbies, social_lobby_members,
social_candidate_offers, social_rooms, social_room_messages,
social_intent_jobs, social_conversation_preferences and
social_linked_plan_identities (server-proven historical plan/session mappings).
Existing social_reports gains room_id and immutable minimized evidence;
there is no separate room-report queue. FKs/checks/uniques/RLS/indexes enforce
ownership, capacity, context membership and bounded values.
Each search creation atomically creates seeking post/lobby/owner membership/job.
Existing legacy seeking and pair flows remain available as Advanced/manual;
existing friend coordination landing moves to /plan with original behavior.

## State machines and consent

Search: active -> filled|closed|expired (no reopening old contexts).
Offer: pending -> accepted|declined|expired|cancelled. Unique search/recipient/revision,
with at most one pending offer per search/recipient even across revisions.
An explicit update or extension can replace a cancelled/expired older revision;
accepted or declined recipients remain excluded.
24h max TTL bounded by search expiry/windows; pending offer budget10/search;
recipients need an active compatible seeking intent, unblocked active identity,
connect capability and offer preferences. Match rank deterministic; rank/privacy
hard filters before score. Work bounded100candidateposts/5offers/batch; expiry and
stop prevent new delivery. Explicit Start authorizes the described search and
sending offers; explicit recipient 'Я в деле' accepts. Neither event alone creates
a room with a nonconsenting third profile. Duplicate accepts idempotent only while
membership remains active; decline/expire cannot rejoin.
Lobby: forming -> ready -> active -> completed -> archived. Occupancy is external
reserved seats + real registered consenting memberships. Transactional lobby lock
plus profile locks enforce capacity and create a unique room when filled, closing
search/post and cancelling remaining offers. Last-slot double acceptance admits
only one. Stop cancels pending offers, keeps any already-created human room subject
to its own lifecycle. Room completion removes it from active home/people; history
is bounded and accessible under current authorization. Completion is self-declared,
not evidence of real-world attendance. Removal/leave closes unsafe room and must
not leave stale send authority. No implicit destructive preference commands.

## Locks, privacy and safety

Lock ordering: use existing sorted profile advisory locks first, then search/lobby
row/advisory lock; reauthorize actor after waits. All candidate recipients included
before creating offers so block/delete/moderation use consistent locks. Context
membership rechecked for every room read/write. Incognito member identities random
persisted per ROOM, unrelated to profile/global/pair aliases; separate room seeds
cannot be joined through public IDs. No exact raw availability, home address,
contact or global incognito customization. Safe offer DTO shows the action and
permitted bounded activity attributes/time hint, no other candidate identities.
Preferences only owner-facing and deletable, never sent to AI/candidates/analytics.
Room reports have immutable minimized evidence under the existing moderator
boundary, retained per safety policy; blocking closes room contact, suspension
prevents direct APIs. Profile deletion erases authored room messages/preferences,
searches/offers/session authority/customization, retains inaccessible tombstones
and protected minimized evidence, closes affected rooms, invalidates subscribers.
Recovery snapshots server-proven linked-plan guest identities before detaching old
bindings so deletion also clears the old creator label and participation.
Retention protects open/reviewing reports and resolved/dismissed evidence for at
least 365 days from both creation and latest update. Intent cleanup exclusively
owns room reports; the legacy social worker must not erase them early. Inactive
searches/rooms are eligible after 180 days subject to report, live-post, offer and
recent-message guards; cleanup remains explicit preview/apply.

## Realtime, notifications, jobs

Extend existing recipient-scoped invalidation topics with intents/rooms; transmit
only fixed topics (no internal IDs/content). Database is truth, reconnect refetches
all current state. Notifications add OFFER_RECEIVED/LOBBY_READY/ROOM_MESSAGE with
safe local links; generic opt-in push stays generic. Durable jobs use SKIPLOCKED,
leases/retries/idempotence and feed existing social:process/Cron. Immediate bounded
best-effort processing after create lets known candidates receive real offers
without waiting a daily scheduler; future candidates still rely on configured
frequent workers, explicitly documented. Creating a new seek schedules relevant
active searches in bounded indexed batches. Quiet hours inhibit offer delivery,
never hide accepted membership; use user's explicit IANA timezone, never IP/GPS.
No endless polling. Failed workers cannot fabricate delivery/progress counters.

## Conversational parsing and preferences

Strict input text<=500/timezone/referenceDate and own prior draft only. Structured
create/update/stop/extend/preferences actions, never candidate IDs or sender IDs.
Dota RU/EN normalization, support/rank/mode enum; gym trainingType/experience,
study subject/level, cinema movie optional bounded text; unknown manual activities
remain supported. For unspecified time ask one question; in-person without city
ask city next if necessary, never silently assume exact location. At most one
question visible at a time; happy path Dota today evening asks none. Wall-clock
future-only validation uses the existing seeking validation at persistence, with
explicit deterministic IANA wall-clock parsing and DST-gap/fold clarification.
Elapsed starts move to the next quarter hour only when at least 15 minutes remain;
otherwise the user is asked for another time instead of receiving an invalid draft.
Commands update only actor-owned active search, invalidate old pending offers,
reenqueue matching; alreadyaccepted rooms do not silently change. Preferences
changes explicit understood review/confirm, saved settings visible under 'Я',
individual rules removable. No hidden AI memory or localStorage raw text/key.

## UX

Three main links Сейчас(/), Люди(/people rooms only), Я(/profile). Almost empty
primary dark composer, few suggestions fill same input, compact live intent objects
with real received/accepted counts, contextual incoming offers, one primary action.
Manual /seek/new and friend /plan links secondary. No ChatGPT bubble transcript.
Inline minimal alias+18+/privacy attestation for new profile and existing one-time
recovery banner; optional advanced profile controls remain under Я. Transparent
preview understood params before Start, one short clarification if needed, reset/
stop controls, actionable offers and temporary room list. Russian throughout,
320px/touch/tablet/desktop, reduced motion/focus/contrast, no remote fonts/deps.

## Analytics and deployment

Add enumerated aggregate intent_created/search_started/offer_delivered/
offer_accepted/lobby_filled/room_opened/activity_completed transitions; disabled
by default, transactional dedupe, no content/IDs. Counts represent actions, not
unique users or real-world attendance. Existing funnels retained. The opt-in
server-only analytics:funnel report adds actions with per-search cohort counts
for candidates, offered, accepted, rooms, conversations, plans, confirmed and
self-declared completion. Message count never becomes conversation count;
deletion/retention can reduce historical cohort totals.
Apply new migrations before publication; do not auto-push migration-dependent
source to live main until database version coordinated. Test only isolated native
PostgreSQL, no real Neon writes/data or paidAI. Current production remains stable.

## Verification

Unit parser/commands/attributes/preference/visibility, nativepg last-slot races/
doubleaccept/dedup/expiry/stop/block/suspension/recovery/deletion/report/membership,
UI minimalcomposer/onequestion/nohugeform/preferences, real2+users browserfulljourney
realtime offers/filled/chat/thirduser denied, mobile320 and8worlds. Independent
read-only auth/privacy/race review; full lint/types/unit/integration/build/E2E,
audit. Evidence local/CI/production clearly separate.
