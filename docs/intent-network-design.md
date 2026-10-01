# Intent Network v1

Intent → Discovery → Interested request → Mutual match → Private conversation →
Existing Veya plan → Activity. The user searches for an action, never a profile
catalogue. The authorized scope is Phases8A–8G; guest invite flows remain intact.

## Architecture and alternatives

Use a separate relational social domain with server-owned guest→profile bindings,
explicit DTO projections, pure matching and the existing AI/coordination domains.
Extending scheduling intents with strangers would mix bearer-link visibility and
private social identity; a separate infrastructure/service would add unnecessary
operations. Keep one Next/pg application, no external identity/chat/AI requirement.

## Identity and recovery

One active guest maps to at most one stable internal social profile. Multiple
sessions can bind to a profile. Guest revocation/expiry continues to invalidate
social access. Profile creation requires an explicit18+ attestation, coarse optional
ageBand and chosen alias; no DOB/GPS/email/password. Veya Key is32 random bytes,
base64url43characters, SHA256 at rest. Explicit create/rotate returns the secret
once in no-store JSON; GET never returns it or its hash. The recovery banner lives
above client route boundaries and holds the secret in memory only until explicit
saved/discard acknowledgement. Issued keys still appear if the initiating screen
unmounts while the successful response is pending; full navigation warns before
leaving an unsaved key. No browser persistent/session storage or analytics. Recover only from an active
unbound guest, lock and recheck sessions/profile/key, reject wrong/revoked keys with
one safe error. Recovery rotates the key atomically and detaches other bindings
(account-takeover containment); guest coordination identity is not replaced.
Rotation/revoke invalidate old keys; recovered coordination invite ownership does
not transfer. This binding boundary supports later federated/email recovery.

## Privacy and identifiers

OPEN: chosen alias/local avatar and explicitly allowed coarse profile fields.
PRIVATE: stable chosen pseudonym/local generated avatar and compatibility facts.
INCOGNITO: random persisted pair-context alias/avatar, no global identity exposed.
Profile and guest UUIDs are server-only. Social domain APIs require the current
guest session; stateless own-text parsing remains optional without a session/DB.
Social pages are generic noindex shells; JSON is no-store with generic metadata; no public username/user directory.
Owner post keys never appear on candidate cards. Persist viewer/source/target-bound
opaque discovery handles; one user's handle cannot request/view another's candidate.
Pair context persists separate random identities for each side, reused only within
that same request/match. Effective privacy is the stronger of profile/post mode.
Never serialize rows: ownProfile/ownPost, discovery, incomingRequest and matched
projection schemas whitelist fields. Discovery hides raw text, exact windows,
contact, exact/private location and hidden profile attributes. Minimal cards show
activity/interaction/format, compatibility reason codes and a coarse time hint.
Matched chat shows pair identity; windows are not automatically disclosed after
match. Disclosures require explicit action, match-only, cannot undo information
already seen; UI warns. No online/presence/last-seen/typing or external avatar assets.
Incognito reduces linkability through APIs; behavior, shared self-disclosure, unique
activities and real-world interactions can identify someone. No absolute anonymity.

## Seeking and matching bounds

Seeking posts: rawText≤500, activity key≤40/label≤80, in_person/online/either,
one_to_one/group/either, city≤60/coarse area≤60,1–14 future nonoverlapping windows
≤24h each within expiry, skill enum,1–5 languages,≤8 tags≤40, desired coarse age
bands≤5, optional groupSize2–12, stronger-only privacy override. Default expiry7d,
maximum30d. Maximum3 active posts/profile (locked admission); closing preserves
interaction history. In-person/either requires city; never home address/GPS.
Pure match input explicit now/bounds; exact normalized activity, compatible interaction
and format/group-size, city when both require physical meeting, real overlap≥15min,
mutual desired ageBand and at least one shared language hard-filter before scoring.
Unknown ageBand cannot satisfy an explicit restriction. Skill gap/tags/coarse area
are explainable ranking factors; no sensitive hidden scoring or AI candidate input.
Maximum100 candidate posts,14 windows/post,5 returned cards,20 new viewer/source/target
contexts per profile per24hours (durable count, repeated handles do not consume more). No arbitrary city-feed
or pagination/total count; discovery requires an owned active source post. Remember
passed/declined/requested pairs and hide both directions of blocks. First bounded
indexed pool100 candidates is not an exhaustive global optimum; document that limit.

## Connections, matches, conversation

Server authorizes current session and profile before locks; serialize involved profiles in sorted order using transaction advisory locks,
reauthorize after waits and recheck expiry/blocks/compatibility. Pending outgoing≤10,
duplicate live requests idempotent, self/cross-owner invalid, only recipient accepts.
Pending requests whose source/target closes, expires or has no future15-minute
intersection become expired on connection reads/admission. This releases slots
without fabricating a decline; fresh posts may form a new request while expired
interaction history stays available. Interval union uses the pure matching helper.
Accept atomically creates one match and conversation. Pair keys are random24chars,
not derived identities. Match membership gates every read/write, blocks close both
sides to sends and disclosures; closed conversation reads retained history with
generic closed state, no blocker attribution. Request decline/pass suppress repeat.
Chat plain text≤2000, random message keys, server timestamps/isMine/pair identity,
recent30, maximum page50, opaque message-key before cursor scoped to conversation.
No sender IDs or client-picked sender. Explicit refresh; no background presence.
One firstName≤60/contactHandle≤120 disclosure per sender/kind/match, explicit consent;
no automatic sharing or analytics. Reports bounded enum+≤1000 text, target concrete
request/match; reporter identity server-owned. No fake automated moderation console.

## Plan integration

Plan it creates/links one ordinary Veya intent under a match lock, using the caller's
current guest as creator and safe pair alias/activity text, never disclosures/raw
private posts. No automatic copying of seeking availability. Both match members
can access the linked bearer invitation and manually add availability/use existing
results/votes/confirmation. Plan slug appears only to authorized unblocked members.
A shared invite retains normal bearer-link semantics; block cannot retract a copied
link or erase an already-created coordination plan. UI explains that boundary.

## Abuse, retention and operations

Independent limiter budgets discovery, seekingCreate, connection, message, report,
recovery plus existing social read/write. Enforce before body/DB/AI; combine global
and SHA256 guest bucket and per-profile durable admission limits. Built-in limiter
is process-local; distributed host/gateway required for public multi-instance use.
Pending10, active3, candidates100/cards5, body16KiB5s, bounded pagination/messages.
New tables have relational CHECK/UNIQUE/FK constraints and server-only RLS. Applied
migrations0001–0004 are immutable. Retention explicit dry-run CLI, social interaction
records eligible after180d closed/inactive, expired seeking posts90d, abandoned
discovery handles/passes90d, reports365d. Recent messages/disclosures, open matches,
active posts/live requests and retained reports protect interaction histories from
cleanup. Profiles/bindings/blocks persist; self-service account deletion is not
implemented. Guest cleanup may remove expired unreferenced sessions and their
bindings. Each category is bounded and separately transactional; partial completion
is possible, reruns safe. Profile deletion cascades reports too: production account
deletion/legal evidence retention needs a defined policy before enabling deletion. No automatic destructive cleanup.
Veya Key recovery leaves old guest sessions usable for original plans but removes
old social bindings. Blocking does not purge received history; reports may retain
bounded evidence. Public meetup safety copy recommends public places, no home address.
Production requires TLS/HTTPS/synchronized clocks, trusted DB/RLS, backups, shared
limiting and human moderation/report handling. No email/SMS/Redis/paidAI service is
needed for complete local v1.

## Verification

Test pure hard filters/ranking/time bounds, recursive forbidden-key projection,
DB constraints/RLS, recovery rotation/revoke/races/session recheck, ownership/request
lifecycle/block ordering/chat pagination/disclosure isolation/plan idempotence and
rate checks before expensive work. Full206existing tests remain. Desktop/mobile
three-person chess/football journey, messages/disclosure/plan/results/block/recovery
plus all existing invite flows. Fresh separate read-only whole-social-diff review
and regression-tested Critical/Important fix pass; check/build/E2E/audit before final.

## Final read-only review and corrections

Independent whole-diff review reproduced stale pending requests consuming all ten
outgoing slots. Native RED/GREEN cases cover closed/expired/time-exhausted posts,
preserved history and a new request for the same pair; adjacent short windows are
merged consistently with discovery. The reviewer classified unsaved key loss on
SPA navigation as Minor. The controller treated it as Important because it can lose
the only recovery credential, implemented persistent memory-only key presentation,
and added route-unmount/in-flight response regression tests. No confirmed Critical
or cross-viewer incognito identifier leakage was found. Final check/browser/audit
evidence and production limits are recorded in CODEX_PROGRESS.md.
