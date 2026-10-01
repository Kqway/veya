# Veya Development Progress

## Current Phase
8G

**Status: Intent Network v1 implemented (2026-10-01).** Original Phases1–7
remain intact (base `f86dd52`). Authorized work covers all8A–8G, separate social
commits and normal fast-forward GitHub main publication. No production deployment.
Verify actual HEAD/remote before continuing; this document describes the release.

## Completed Phases
- **Phase 1 — foundation** (`5766774`): responsive landing, strict Next.js/React/
  TypeScript, Tailwind, service/configuration boundaries, tests and CI.
- **Phase 2 — database and backend** (`aeb73e0`): nine tables, checked migrations,
  RLS boundary, transactions, guest sessions, authorized APIs and database CLI.
- **Phase 3 — intent and invite flow** (`3544ab4`): persistent creation/sharing,
  no-account participation, local availability, budgets/preferences, guest editing
  and bounded opt-in entry analytics.
- **Phase 4 — scheduling engine** (`f969f52`): deterministic overlap, compromises,
  alternatives, cached results, privacy-safe attendance, votes and confirmation.
- **Phase 5 — AI layer** (`3a0c9c3`): reviewed structured parsing, public advisory
  hints, optional meetup ideas and grounded explanations, mock/OpenAI fallback.
- **Phase 6 — viral UX** (`131dd1f`): compact mobile creation, focus/loading/
  selection feedback, resilient sharing, offline public-only previews and repeat
  creation with bounded navigation-safe analytics. Published and remote verified.
- **Phase 7 — release hardening** (`phase-7: release hardening`): post-lock
  temporal authorization, saved elapsed-window editing, overnight entry, unmount
  guards, bounded API/scheduler workload, headers, explicit retention and release
  verification. All domain-audit findings fixed; fresh final review has no findings.

- **8A — social identity and privacy** (`5eb6380`): guest/profile binding,
  adult attestation, hash-only Veya Key recovery/rotation/revoke, explicit privacy
  projections, native session/lock/recovery races and database constraints.
- **8B — seeking and deterministic discovery** (`f8f3245`): bounded relational
  posts, pure explainable matching, optional strict own-text AI parser/fallback.
- **8C — private matching** (`ad584c9`): viewer-bound discovery handles, random
  pair identities, visible idempotent requests and atomic acceptance, stale pending
  expiration/history, durable twenty new discovery contexts/profile/24h.
- **8D — conversation and disclosure** (`bc23aa3`): authorized plain-text chat,
  precise scoped message cursors, generic closed state and explicit match-only
  first-name/contact disclosure with immutable consent-based values.
- **8E — planning integration** (`d745919`): atomic one-plan-per-match bridge into
  the existing intent/scheduling/voting/confirmation domain, safe aliases only.
- **8F — safety and privacy hardening** (`0946099`): mutual blocks, bounded reports,
  independent rate budgets before expensive work, strict no-store social HTTP,
  RLS/constraints, explicit dry-run social retention integrated into the CLI.
- **8G — Intent Network release** (`social: intent network release`): complete
  mobile social UX, memory-only persistent recovery-key banner, manual/reviewed AI
  post editor, discovery/requests/chat/disclosure/safety/plan screens, desktop/mobile
  acceptance and recovery tests, full privacy review and updated release docs.

## Current Architecture

- Next.js16.3.8/React19.3, strict TypeScript, Node24 LTS recommended (22.12 minimum),
  native PostgreSQL through parameterized server-only pg. No new dependencies.
- Original coordination `/i/[slug]`/results and guest/session APIs remain. Social
  `/discover`, `/seek/new`, `/seek/[key]`, `/connections`, `/m/[key]` plus bounded
  `/api/social/*`. Generic social metadata/noindex; sensitive JSON no-store.
- Separate social domain; existing scheduling intents are reused only via explicit
  Plan it. Guest cookies remain HttpOnly/SameSiteLax/Secure in production, hashed
  server-side,30d. Guest→social profile binding is server-owned, never client IDs.
- Sorted involved-profile advisory locks, guest session shared locks and current
  binding/expiry reauthorization after waits. Recovery atomically replaces the key
  and social bindings; old coordination guest ownership is preserved separately.
- Explicit own/discovery/incoming/matched Zod projections. No social database rows
  serialized directly; no UUIDs/session hashes/recovery hashes/IP/private windows,
  raw hidden text/contact/global Incognito alias in candidate/pair responses.
- OPEN chosen alias, PRIVATE stable pseudonym, INCOGNITO random persisted pair
  aliases/avatar seeds independent of profile IDs. Strongest profile/post/privacy
  context wins. Local generated avatars, no tracking URLs or global directory.
- Pure social matching independent of AI/SQL/UI: activity/mode/city/format/real
  future15min overlap/language/mutual optional age-band requirements before score;
  skill/coarse area/shared tags explain ranking. Numeric scores stay server-side.
  Merged intervals shared with pending request expiry checks.
- Bounds: activeposts3, windows14/post≤24h within30d, tags8, languages5, candidate
  pool100/cards5, twenty new discovery contexts/profile/day, outgoingpending10,
  chat2000chars, recent30/max50 messages, requestlist30/matchlist20, reports1000chars.
- Visible Interested request → recipient acceptance → atomic match/conversation.
  Closed/expired/time-exhausted requests become expired during connection reads/
  admission, preserving history and freeing slots; fresh posts may request again.
  Pass/actual decline stay remembered. Acceptance is the only match creation action.
- Chat plain text, public message key/timestamp/isMine/pair identity, bounded opaque
  cursor scoped to conversation. No presence/online/last seen/typing. Explicit
  refresh. Disclosure first_name/contact_handle is voluntary, explicit consent,
  match-only and immutable; recipient may retain information already seen.
- Block closes match/conversation to sends/disclosures/plan access and suppresses
  both discovery/request directions; retained history reads expose generic closed
  status without blocker attribution. Concrete interaction reports, no fake moderation.
- Plan it creates an ordinary intent atomically under the same pair lock, safe
  alias/activity only; manual participant entry feeds unchanged pure deterministic-v2
  scheduling/results/revision/votes/confirmation,32participants/128totalwindows.
  No automatic availability or disclosure copying. Copied invites remain bearer links.
- Optional own-text seeking AI uses existing mock/OpenAI provider abstraction:
  strict JSON,1000tokens,storefalse,64KiB envelope,8s deadline,no retry/redirect/raw
  logging. Local narrow EN/RU fallback/manual entry works without keys/network.
  AI never receives candidate private profiles, ranks people or sends messages.
- Independent RequestLimiter social read/write/discovery/seekingCreate/connection/
  message/report/recovery budgets before body/DB/providers; existing AI/manual/
  analytics budgets preserved.4096 hashed guest/action buckets, global quotas,
  process-local fixed60s windows; distributed hosting needs shared/gateway controls.
- JSON≤16KiB/wholebody5s, clientrequest15s. Mutation same-origin validation. Existing
  nosniff/DENY/no-referrer/disabledcamera,microphone,GPS/same-originCORP preserved.
- Migrations0005identity,0006seeking,0007connections,0008conversation,0009planlink,
  0010safety; RLS no permissive client policies, CHECK/UNIQUE/FK/indexes/ownership
  triggers. Original0001–0004 SHA256 unchanged. Owner/BYPASSRLS database only.
- Explicit dry-run cleanup100/category,max500: oldcoordination90d postexpiry,
  unreferencedguests7d expiry/revoke,analytics30d; reports365d, abandonedhandles/
  passes90d, expiredposts90d, inactivepairhistories180d with live/recent/report guards.
  Separate transactions/SKIPLOCKED, sorted profile locks/recheck. Profiles/bindings/
  blocks persist; guest deletion may remove its binding. No automatic cleanup.
- Disabled analytics unchanged nine event names/fixedsurface/timestamps. Social
  profile/key/post/chat/disclosure/report content is never included in analytics.
- Testing Library/Vitest/native isolated PostgreSQL plus Playwright-owned isolated
  database/production Next server, desktop/mobile Chromium. No tests/cleanup reset
  development/production databases, no paid provider calls or deployment performed.

## Important Decisions and Privacy Limits

- Intent → Discovery → Connection request → Mutual match → Private chat → existing
  Veya plan → activity. Search is action-first, no users endpoint/profile directory.
- Veya Key is32cryptographic random bytes/base64url43chars, SHA256only at rest;
  GET never returns it. Create/recover/rotate only explicit one-time flows. Recovery
  from an active unbound guest rotates the key and detaches all old social sessions;
  revoke/rotation invalidate previous credentials. No home-grown passwords/email/SMS.
- Recovery banner above client route boundaries holds key in memory only until
  explicit saved/discard. Beforeunload warns for full navigation; a successful key
  response still displays if the originating profile screen has unmounted. No local/
  sessionStorage/analytics/logging. Clearing the cookie and losing/revoking the key
  prevents recovery in v1; future federated recovery can reuse the binding domain.
- Incognito prevents API cross-pair identity joining, not absolute anonymity. Server
  operators retain internal relationships. Self-disclosure, behavior, unusual
  activities and physical meetings can identify someone. Privacy changes cannot
  erase previously seen aliases/messages/disclosures. Pair aliases persist within
  the same pair, not a new identity on every message.
- Profile18+ self-attestation, optional coarse age bands; no DOB/homeaddress/GPS/
  appearance filters/contact upload. First-meet copy recommends public places.
- Exact seeking windows remain private even after match; users explicitly enter
  their own availability in the ordinary linked plan. That invite's normal public/
  own/member projections and bearer semantics continue unchanged. Block cannot
  retract copied links, messages or disclosures or delete an ordinary plan.
- Group format matches compatible posts but social request/chat remains between
  two profiles; ordinary invitations can collect the rest of a group. Time hints
  use coarse UTC calendar days; availability picker/display uses browser timezone.
  Bounded candidatepool100 is not an exhaustive city-wide global ranking.
- Reports require human handling; no admin moderation console is included. Stable
  profile retention/account-deletion/evidence policy must be set for public launch.
  Explicit profile deletion cascades reports; no account deletion UI/API is exposed.

## Tests Status

- Final `npm run check`: zero-warning lint, generated route types/strict TypeScript,
  **398 tests in43 files — PASS**, optimized production build — PASS.
  **192 new tests** plus all206existing; no old assertions weakened.
- New desktop/mobile social subset **4/4 — PASS**: A/B/C discovery/Interested/
  acceptance/pairaliases/messages/explicitdisclosure/ordinaryplan/results/block,
  and recovery/invalid/reused/revokedkey/detachedbinding/originalguestownership.
- Final complete desktop/mobile `npm run test:e2e`: **38/38 — PASS**, including
  all34original cases and4new social/recovery executions against real isolated
  PostgreSQL and the production server. Desktop/mobile screenshots inspected;
  plain-text XSS payload displays safely, closed chat retains history, no overflow.
- Lint/typecheck repeated after final browser transport edits — PASS.
- Fresh whole-social-diff read-only review found stale pending requests exhausting
  ten slots and client-route key loss. Native closed/expired/time-exhausted RED→GREEN,
  preserved history/same-pair renewal and interval-union regressions added. Controller
  regraded reviewer Minor key-loss finding Important because it can lose the only
  recovery credential; route-unmount/in-flight response UI RED→GREEN fixes added.
  No confirmed Critical or cross-viewer incognito API identifier leakage; all
  reproducible Important findings fixed, no repeat reviewer or deferred findings.
- Initial social browser attempts exposed exact-label selector and Secure-cookie
  testtransport issues. Tests use accessible combobox roles and real same-origin
  browser fetch for auxiliary requests; production authentication was not weakened.
- `npm audit --json`: **0 vulnerabilities**, no dependencies added. Final migration
  hashes/staged whitespace/credential/artifact inspection recorded before publication.

## Production-only Work and Known Limitations

- Configure HTTPS Nodehost/publicorigin, server PostgreSQL/TLS/migrations/backups,
  shared/gateway limiting, host-level anti-abuse and human report ownership. Durable
  profile discovery budgets do not prevent separate-profile creation attacks.
- Live OpenAI, hosted PostgreSQL/Supabase, actual production deployment and remote
  CI are not verified here. Local fallback and injected bounded transport tests pass.
  No external identity/email/SMS/chat/avatar/Redis/GPS/paidAI service is needed for
  the complete local flow; optional OpenAI requires allowed egress and a valid key.
- Native device share sheets/social preview caching/Safari/other browsers require
  host/device checks. Screenshots/320px Chromium flows are covered locally.
- Chat/results/connections refresh explicitly; no realtime sync or autonomous AI.
  Mock understands narrow activities, unknown fields require manual completion.
- No absolute anonymity claim, no public directory, dating mechanics/followers/
  ads/payments/automatic contacts/location tracking or fake moderation automation.

## Next Work / Notes for Next Codex Run

Read README, docs/intent-network-design.md, docs/social-api-contract.md and
[release checklist](docs/RELEASE_CHECKLIST.md). Verify HEAD/tree/remote, migrations,
actual services and tests before assuming this record is current. Preserve server
identity, privacy by explicit projection, sorted lock order/post-wait reauthorization,
Veya Key one-time flow, deterministic cores and original scheduling invite ownership.

No additional feature expansion is required to complete this authorized v1.
Suggested next independent improvements: hosted reliability and moderation workflow,
optional federated recovery/account deletion policy, broader activity normalization,
timezone-aware coarse discovery hints. Do not implement them without a new task.

Normal fast-forward publication is authorized; no force push/history rewriting or
production deployment. Applied migrations must never be edited. Future changes
need new numbered SQL. Maintenance defaults dry-run; --apply deliberately deletes
only after target/backup checks. Tests own ephemeral databases/port3100; build
before E2E and never redirect tests to a real development/production database.
