# Social v1 client contract
All JSON `/api/social/*`, same-origin cookie, no-store. POST JSON, `ensureGuest()`
only before first profile create/recover. Errors `{error:{code,message}}`,403/404
privacy-safe,401 expired guest,409 inactive/capacity,429 Retry-After.

GET /profile → {profile:null|{alias,privacyMode:OPEN|PRIVATE|INCOGNITO,avatarSeed,
ageBand:null|'18-20'|'21-24'|'25-29'|'30-39'|'40+',languages:string[],hasRecoveryKey:boolean}}
POST /profile {alias,privacyMode,adultConfirmed:true,ageBand?,languages?} → {profile,recoveryKey}
PATCH /profile same fields exceptadultConfirmedoptional (strict update schema)
POST /profile/recover {key} → {profile,recoveryKey} (rotated; save once)
POST /profile/key {} → {recoveryKey} rotate
DELETE /profile/key → {revoked:true}
DELETE /profile {confirmation:"DELETE"} → {deleted:true}

Deletion requires an active current guest and server-owned binding, accepts no profile
identifier, and remains available to suspended owners. Repeated deletion by an active
unbound guest succeeds safely. It invalidates keys/bindings, removes own personal
content, closes conversations and cancels delivery. Frozen moderation evidence and
peer-authored closed history remain; see closed-beta-design.md.

GET /seeking → {posts:OwnPost[]}
POST /seeking → OwnPost with publicKey
GET /seeking/:key → OwnPost (owner only)
DELETE /seeking/:key → {closed:true}
OwnPost/input: rawText,activityKey,activityLabel,interactionMode:in_person|online|either,
format:one_to_one|group|either,city:null|string,area:null|string,
availability:[{startAt,endAt}],skill:beginner|casual|intermediate|advanced|expert|any,
languages:string[],tags:string[],desiredAgeBands:string[],groupSize:null|2..12,
privacyMode(optionalinput),expiresAt(optionalinput). Output adds publicKey/status.
POST /ai/seeking {text,referenceDate,timeZone} → {data:SeekingSuggestion,source}
Suggestion fields activityKey/Label,interactionMode,format,city,area,skill,timeHint
nullable;languages/tags arrays. Advisory timeHint only; review/apply explicitly.

GET /discover?source=OwnPost.publicKey → {cards:Card[]}
Card {handle:string24,identity:{alias,avatarSeed},activityLabel,interactionMode,format,
reasons:string[],timeHint:string}; no rawText/city/skill/windows/profile/post IDs.
POST /discover/:handle/pass {} → {passed:true}
POST /connections {handle} → {publicKey,status:pending|accepted|declined|expired,matchKey:null|string}
GET /connections → {requests:RequestDTO[]}
RequestDTO {publicKey,direction:incoming|outgoing,status,identity:{alias,avatarSeed},
activityLabel,matchKey:null|string}
POST /connections/:key/respond {action:accept|decline} → {publicKey,status,matchKey}

GET /matches → {matches:MatchDTO[]}
GET /matches/:key → MatchDTO
MatchDTO {publicKey,status:active|closed,identity:{alias,avatarSeed},ownIdentity:{alias,avatarSeed},
activityLabel,disclosures:[{kind:first_name|contact_handle,value,isMine}],planSlug:null|string}
GET /matches/:key/messages?before=messageKey&limit=30 → {messages:MessageDTO[],nextBefore:null|string}
MessageDTO {publicKey,text,createdAt,isMine,identity:{alias,avatarSeed}}
POST /matches/:key/messages {text} → MessageDTO
POST /matches/:key/disclosures {kind,value,consent:true} → {shared:true}
POST /matches/:key/plan {} → {publicSlug} (normal /i/:slug)
POST /block {requestKey:...} OR {matchKey:...} → {blocked:true}
POST /reports {requestKey:...|matchKey:...,reason:spam|harassment|unsafe_meeting|impersonation|other,text?:string} → {reported:true}

Screens /discover, /seek/new, /seek/[key], /connections, /m/[key]; profile create/
recovery inline at /discover and /seek/new; profile controls at /discover. No social
metadata uses records; generic noindex only. Generated SVG/CSS avatar seed local.

## Phase 9 live delivery and notifications

`GET /api/social/events` authenticates the current guest/profile only; query strings
cannot select another profile or match. SSE `sync` has `{}`; `invalidate` has
`{topic, matchKey?}` with topic connections/match/notifications/discovery and only a
currently authorized active match key. Event IDs are random per-recipient cursors,
never numeric database sequences. No profile IDs, identity aliases, private content,
recovery/session material or presence is streamed. Backfill caps at 100; expired
cursors/overflow trigger persistent API reload. Heartbeats reauthorize access;
streams last at most five minutes. One browser provider shares subscriptions,
cleans them up and uses six bounded reconnect attempts plus manual retry.

`GET /api/notifications?before=<own-key>&limit=1..50` returns
`{notifications:[{publicKey,type,createdAt,readAt,href}],nextBefore}`.
`GET /api/notifications/unread` returns `{unreadCount,capped}` (maximum 1000).
`POST /api/notifications/<own-key>/read` accepts `{}`. Blocked/suspended/closed
contexts are hidden from reads and push. Types: INTEREST_RECEIVED,
INTEREST_ACCEPTED, NEW_MESSAGE, PLAN_READY, MEETUP_REMINDER, CANDIDATE_FOUND.

`GET /api/notifications/push` returns `{enabled,publicKey}`;
POST/DELETE accept a strict browser subscription/endpoint respectively. Registration
is opt-in, requires current server-owned profile membership, caps at five and accepts
only HTTPS endpoints of supported browser push providers. The generic encrypted
payload is `{title:'Veya',body:'You have a new update in Veya',url:'/notifications'}`.
It contains no aliases, activity, match key, location or message. Push is best effort,
not read acknowledgement. Unsupported/denied browsers keep the inbox usable.

`/api/moderation/*` uses a separate hash-only eight-hour moderator cookie issued by
an environment-secret login, not guest identity/client roles. Case queue/evidence
and actions are authenticated, no-store and audited. Mutations require the trusted
origin. Suspended profiles cannot use social APIs even after Veya Key recovery;
capability restrictions independently prevent new posts/connections.

## Closed beta operational policy

Server-only centrally validated BETA_SIGNUPS_ENABLED, BETA_SEEKING_ENABLED and
BETA_READ_ONLY flags return safe 503 errors before budgets or domain work. Read-only
pauses discovery because it allocates handles/pair identities. Existing connections
are readable without expiring rows, and coordination results read persisted caches
without creating new suggestions. Health/readiness, deletion, revocation, push opt-out
and explicit human safety actions remain available. Operational quota writes can
continue; the flag is an application maintenance policy, not PostgreSQL read-only.
