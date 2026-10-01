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
