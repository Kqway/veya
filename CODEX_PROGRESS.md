# Intavro Development Progress

## Rollout tooling follow-up: offline Neon18→20 console upgrade

Starting source `78d800fc1f81979b8e942b70a379a618d3105bd5` has full hosted quality/
container SUCCESS in [run37284505275](https://github.com/Kqway/veya/actions/runs/37284505275):
958 tests/92 files, ordinary66/66 and Vercel66/66, audit0, both Docker/non-root and
isolated migration/worker/readiness/backup-restore gates. No production publication.

Read-only Vercel inspection on2026-10-05 confirms project `intavro`, Node24,
production deployment `dpl_DuUtzSHGNsfRAtVD3aqwhbGXU6Xt` on `ae68914` and Neon
Marketplace integration. Database variables are sensitive, scoped to production;
this workspace has no DB URL, Neon API key or authenticated Neon/Vercel CLI. No
production DB access, backup, migration or maintenance was performed in this pass.

Added offline `db:release:sql`: separate single-DO atomic upgrade18→20 and read-only
full-ledger verification for Neon Query Editor. It reads only immutable source SQL,
never env/credentials or a DB. The prepared-protocol bundle checks strict18/20
history before DDL, shares the existing migration lock (10s lock wait), targets
public, rolls back all DDL/ledger on failure and safely repeats a verified20 run.
No old or new migration file changed. See [the owner procedure](docs/NEON_RELEASE_18_TO_20.md).

Native12 regressions PASS: extended/prepared execution, existing data preservation,
idempotency, concurrent runs, foreign/checksum/missing ledgers, second-DDL rollback,
independent verification and inherited search_path. An initial pg_catalog-first
DDL target failed natively; explicit public with implicit catalog lookup corrected
it before release. Strict array access typing corrected without relaxed checks.
Independent read-only review found no actionable Important/Critical issue and
reran all12 native regressions PASS. Fresh `npm run check` PASS: zero-warning lint,
strict types, **970 tests/93 files**, production build. Fresh audit0 PASS. Operations
image build and offline non-root/read-only/no-network generator smoke PASS;
both SQL outputs match host generation even with an unusable dummy DB URL.
Invalid CLI flags refuse generation with exit1 and no SQL output. Final hosted
evidence is recorded for the exact source in the PR. Protected backup/restore rehearsal, operator DB access,
maintenance, actual schema verification and hosted promotion remain required.

## Current local candidate: Profile Worlds + minimal intent product

Starting HEAD: `ae68914ede1923f6d93cf888403fc397e9b42cf4`. Implementation commits:
`d5b72b3` (bounded profile foundation) and `540e4cd5553da792c115c3acb80c470e85bb6642`
(profile UI/context services and consented intent-to-room orchestration). This
documentation checkpoint follows those verified sources on
`codex/intent-worlds-20261005`. Production [intavro.vercel.app](https://intavro.vercel.app)
remains the verified **18-migration** baseline. This pass has no production
migration/deployment. The initial local checkpoint is below; subsequent hosted
CI findings and their test-isolation correction are recorded separately.

- Additive **0019_profile_spaces.sql** and **0020_intent_lobbies.sql**; old 0001–0018
  are immutable. Eight Profile Worlds, explicit visibility and owner editor; stranger/
  connection projections require authorized discovery/request/match context.
  Incognito hides global customization and keeps scoped presentation.
- `/` is the minimal «Сейчас» composer; `/people` contains temporary rooms;
  `/profile` is «Я». Original friend coordination composer moves to `/plan` and
  existing invitation/scheduling/results/voting/confirmation behavior remains.
- Reviewed own-text interpretation, one clarification at a time, explicit Start,
  persisted searches, deterministic compatible offers and explicit acceptance.
  Local fallback works without AI. Owner-only removable preferences and quiet hours
  are visible, not hidden AI memory.
- Atomic consent/capacity checks create a room only when the lobby fills. External
  reserved seats are declared by the owner and never appear as invented members.
  Plain-text chat, leave/remove/block/report, completion/history and original Plan it.
- Aggregate intent transitions and `analytics:funnel` actions search cohort (six new
  native tests); counts are per search, not unique users/verified attendance, and
  deletion/retention can reduce historical counts.
- Recipient-scoped fixed `intents`/`rooms` realtime topics and minimal notifications.
  Durable jobs use existing CLI/Cron; bounded immediate work serves known candidates,
  but future candidates/retries need a frequent scheduler. Daily Hobby Cron is insufficient.
- Room reports extend existing `social_reports.room_id` with immutable minimized
  evidence; no separate room-report table. Deletion erases authored personal content,
  customization/preferences and authority, preserving protected evidence/peer history.
  Historical server-proven linked-plan identity bindings prevent recovered-session
  aliases/participation from surviving later deletion.

**Local evidence, 2026-10-05, Node 24.19.0:** fresh full `npm run check` PASS:
zero-warning lint, strict types, **952 tests / 91 files** (+241/+12 over baseline),
production build. Fresh `npm ci --offline` PASS and `npm audit --json` reports
**zero vulnerabilities**. Full ordinary **66/66** and isolated Vercel-mode **66/66**
desktop/mobile E2E PASS, no retries (+10 browser cases per runtime). Both Docker
targets build; non-root runner/operations smoke and actual isolated PostgreSQL18
all-20 migration/repeated migration/verification, concurrent workers, retention
preview, safe readiness and protected backup/empty-database restore PASS.
Final zero-warning lint and strict types also passed separately. Hosted CI is a
separate gate; no result for this source is claimed at this documentation checkpoint.

Managed Docker's vfs driver initially exhausted disk during container smoke.
The operations target now copies source/locked dependencies from the dependency
stage rather than inheriting the compiled web build. Smoke runs backup/restore
before web startup and cleans its own disposable volumes; all original assertions
remain. The corrected full data smoke passed without ignoring failures. Final
operations image `sha256:0c0393e2eec37145af84ba61f34b1677355529461ee44a33e1b4824820df1e6b`;
runner `sha256:742764faf2f900b223e2f02e678ea65e3820f16a84a84438583021749a2567ca`.

The initial full ordinary E2E exposed a Profile Worlds editor accessible-label
bug: a select label included its option text, breaking exact accessible-name lookup.
Specific `aria-labelledby` spans now name intent/visibility selectors; retained
first-failure trace, **9 targeted DOM tests PASS** and fresh production build PASS.
Targeted real-browser eight-world/legacy social rerun **4/4 PASS**, followed by both
complete browser gates above. Duplicate save announcements were corrected with a
RED→GREEN DOM regression; browser Back protection passed desktop/mobile. The
profile block browser test now waits for the committed block and closed UI before
requiring 404 from profile APIs, preserving every authorization assertion.

Independent actual read-only review reproduced two Important issues and fixes:
legacy cleanup could remove a newly resolved old room report inside its 365-day
protection period; search updates could permanently suppress recipients after
cancelling previous-revision offers. Native RED→GREEN regressions verify the room
report exclusion and revision-aware dedupe with one pending offer per recipient,
while declines remain remembered (**42 targeted tests PASS**). A subsequent
independent read-only verification ran **48 native PostgreSQL tests PASS**, with
no additional confirmed Important/Critical issue in the inspected boundaries. See
[security-minimal-intent-review.md](docs/security-minimal-intent-review.md) for scope
and limits; this is not a complete external security audit.

Rollout: preserve live `main` until coordinated backup/migration verification of all
20 migrations; review the feature branch/PR, then promote source only after database
readiness and hosted release gates. The feature branch is explicitly excluded from
automatic Vercel deployment; this does not block production `main` deployment.
Do not reuse live credentials in tests or previews.
See [deployment](docs/DEPLOYMENT.md), [checklist](docs/RELEASE_CHECKLIST.md),
[intent API](docs/intent-product-api.md) and [product design](docs/minimal-intent-product-design.md).

### Hosted quota-isolation follow-up

GitHub source `1b2764898e11f4532db04b4cc163f90be6038b0a`,
[run 37279461008](https://github.com/Kqway/veya/actions/runs/37279461008): container
job SUCCESS; quality install/lint/types/tests/build/audit SUCCESS, ordinary browser
gate **64/66**. Preserved traces showed HTTP429 with Retry-After1/2 seconds in the
profile Back and recovery journeys. Independent fast browser journeys shared the
same global limiter budgets; this was fixture coupling, not an authorization failure.

The corrected test-only fixture resets only limiter buckets before each unrelated
journey. Production policies/provider are unchanged and remain enforced throughout
each journey. Control requires a private600 file in an owner-only700 temporary
directory, validated native loopback test URL and a random capability confirmed
against a marker created only by the isolated test server. No production endpoint
or inherited DATABASE_URL is used. Cleanup removes only its own file/empty directory.
Six new native regressions prove quota rejection within a journey, isolation across
journeys and refusal of foreign configuration/wrong capabilities; the existing
seven shared-limiter regressions remain unchanged. Fresh lint/types and full
**958 tests / 92 files PASS** (+247/+13 over the starting baseline). Fresh production
build and audit0 PASS; corrected ordinary desktop/mobile browser gate **66/66 PASS**,
no retries. Independent follow-up reviewed the fixture boundary and reran all
**13 native fixture/shared-limiter tests PASS**, with no reproducible Important/
Critical finding. Corrected full Vercel-mode desktop/mobile browser gate also
**66/66 PASS**, no retries. Final hosted follow-up remains a separate gate: this
checkpoint records local verification and the preceding failed hosted run, not
an assumed remote PASS. The PR will record the exact final source/run result.

Hosted source `7e78aeeedb9959f4177533d0fbad5f1ffa60e91b`,
[run 37283228419](https://github.com/Kqway/veya/actions/runs/37283228419): container,
install/lint/types/958 tests/build/audit and ordinary **66/66 PASS**. All quota-
affected profile journeys passed in both runtimes. Vercel-mode finished **65/66**:
the legacy 404-to-home assertion selected any textbox, but the hydrated anonymous
home correctly has both an intent textarea and a profile alias input. Explicitly
waiting for alias hydration reproduced the same strict-selector failure on both
desktop/mobile locally. The test now checks home URL and both exact accessible
field names; targeted Vercel desktop/mobile **2/2 PASS**, preserving 404 and home
visibility checks. Application code is unchanged. Final full browser/hosted gates
are recorded in the PR after verification; this record does not assume a PASS.

## Previous release: managed Neon connection

Starting HEAD: `bc0e304ffc051bae1456cbbdf50582afb3aaf9be`. Owner created and linked
the free Neon Marketplace resource in the same `iad1` region as Vercel, then reports
executing the 18-migration bootstrap. Vercel credentials are sensitive and cannot be
read through the connected tools; no credentials were copied into chat, Git or tests.

- Vercel server-only configuration now uses Marketplace `DATABASE_URL_UNPOOLED`
  when no explicit realtime URL is supplied. Explicit operator configuration wins;
  fallback URLs are validated and errors name fields without credential values.
- Explicit verified TLS upgrades Neon's single require-mode default to verify-full
  only on Vercel and `.neon.tech` hosts. Query/LISTEN drivers retain certificate and
  hostname verification; weak/conflicting options and realtime pooler hosts fail closed.
- Removed preview targets from all current provider variables; disabled automatic
  preview deployments until an isolated synthetic database exists. Future Storage
  connection synchronization must retain production-only credential targeting.
- Prepared-query rejection of the initial manual bootstrap was reproduced on native
  PostgreSQL. A single atomic DO variant preserves all 18 exact migration checksums,
  advisory lock, repeat/concurrent safety and CLI compatibility; rollback/mismatch
  regressions pass. No applied migration changed and no new migration was added.

Fresh local `npm run check` PASS: lint, strict types, **711 tests / 79 files** (+11),
production build; audit0. Full desktop/mobile E2E **56/56 ordinary +56/56 Vercel-mode
PASS**, no retries. Provider fallback is cleared from isolated browser environments;
tests never use the hosted database. Read-only security follow-up is recorded in
[security-vercel-review.md](docs/security-vercel-review.md).

**Hosted verification, 2026-10-04:** source
`5587feffcacdb87ac51bcf7b63d0c60811fada8c`, production deployment
`dpl_BZbLFmmSDbExjZeNiXits4hX7oci`, reached READY and serves
[intavro.vercel.app](https://intavro.vercel.app). Actual HTTPS checks: Russian
landing200 with correct HTTPS OG metadata, health200, **readiness200** (independently
verifies all18 migration names/checksums in the hosted database), OG image200/PNG/
no-store, unauthenticated Cron401. Migration execution is now independently verified,
not just owner-reported. No credentials or personal data were included in the checks.

Source [CI run37223876329](https://github.com/Kqway/veya/actions/runs/37223876329):
container job111499434209 **SUCCESS**, including both Docker builds, non-root runner/
operations and isolated migration/worker/backup/restore smoke. Quality job111499434011
passes lint/types/tests/build/audit and is still running its browser gates at this
documentation update; the overall CI run is not yet claimed PASS. The follow-up
changes only this verification record and triggers another normal production build.
Actual hosted two-user/reconnect/device smoke, frequent scheduler and backup/restore
operation remain rollout checks; the complete flow is verified locally in both modes.

## Previous release: Vercel + Neon hosting preparation

Starting HEAD: `38c9f8d7a842ee35bc1d5f90da937ae12861ea76`. The existing Russian
Intavro closed-beta candidate now supports native Vercel Next.js hosting with
external Neon PostgreSQL; no product/domain architecture or applied migration changed.

- Node 24, Vercel config, explicit runtime SQL/font file tracing, two-query-connection
  default on Vercel and `@vercel/functions` query-pool lifecycle attachment.
- Authenticated SSE remains persistent-outbox-backed; 240-second streams within
  a 300-second function budget. Shared instance hub retains subscription caps and
  closes after the last response, including requests still authorizing; VPS lifecycle
  remains unchanged.
- Machine-only `/api/cron/social`, separate validated `CRON_SECRET`, timing-safe
  bearer check before DB, five-job batches, cooperative 45-second stop, existing
  durable leases/deduplication, read-only skip and numeric safe logs. No HTTP migration
  or destructive retention. Daily Hobby-compatible default; a minute scheduler must
  be configured for timely beta candidates/push/reminders.
- [Vercel/Neon guide](docs/VERCEL_NEON.md): pooled/direct URI distinction, verified
  TLS, production/preview isolation, manual migrations, backups, optional push/AI
  and actual HTTPS/mobile/two-user/reconnect smoke. No database credentials in Git.
- Independent [review](docs/security-vercel-review.md) reproduced an Important
  initial per-request hub cap bypass. Shared response-counted hub fixes it; native
  regression and re-review pass. No remaining confirmed Important/Critical finding.
- CI now repeats all desktop/mobile journeys in both ordinary and isolated Vercel
  mode, stripping inherited Cron/hosting credentials. Tests never use hosted Neon
  or paid AI.

Local evidence: fresh `npm ci`, lint/typecheck, **700 tests / 79 files** (+11),
production build and audit0 PASS. **56/56 ordinary +56/56 Vercel-mode E2E PASS**, no
retries. Actual NFT manifests contain all18 migrations and both OG fonts. Both normal
Docker targets build successfully; final local non-root web/operations smoke PASS.
Local VFS ENOSPC interrupted early browser and container smoke attempts; browser
gates reran completely after task-owned cache cleanup. The local DB smoke reached
migrations/concurrent workers/readiness/OG/retention, but restore could not create
the empty database because disk filled again. This is recorded as an environment
failure, not a local PASS. The exact source's hosted container job independently
passes the complete isolated migrations/workers/readiness/backup/restore smoke.
Temporary local npm dependencies were restored with `npm ci` after container checks.

**Remote evidence: PASS.** Source `98ca60ed680612100552f99e55fed489b197edb4`,
[run 37217132677](https://github.com/Kqway/veya/actions/runs/37217132677):
quality job `111479815387` and container job `111479815302` both SUCCESS. Hosted
Node24 repeats lint/strict types, 700 tests/79 files, production build, audit0 and
56/56 ordinary +56/56 isolated Vercel desktop/mobile E2E. Both Docker builds,
non-root smoke and complete isolated PostgreSQL migration/worker/readiness/OG/
backup/restore smoke PASS. This follow-up changes documentation only and records
the verified source commit; it does not claim a Vercel or Neon deployment.

**Publication status, 2026-10-04:** the owner reauthorized the `kqway1` Vercel team.
Created `intavro`, linked to `Kqway/veya` / `main`; the first deployment of
`5f4c2b2c019c6f59ce234e8d506fdacb42b5dc32` reached READY. Assigned public domain:
[intavro.vercel.app](https://intavro.vercel.app). Hosted Russian landing and
`/api/health` return 200. `/api/ready` returns a safe 503 because no Neon database
has been provisioned or migrated: social/coordination functionality is not yet live.

Configured Node 24, Fluid compute / 300-second default budget, production trusted
origin `https://intavro.vercel.app`, verified TLS settings, two-connection query pool,
PostgreSQL shared limiting and optional-AI mock provider. Independently generated
Cron and moderator credentials are encrypted production-only Vercel variables;
no secret is stored here. Preview deployments retain Vercel Authentication and
receive no production credentials. A subsequent deployment picks up these settings.

Neon plugin installation is confirmed, but this session exposes no Neon provisioning
operations and has no authenticated CLI/provider credentials. Vercel reports no
installed Marketplace integrations. Owner must connect a Neon database to this
project (production only), or authorize callable Neon provisioning. Then configure
pooled/direct verified-TLS URLs, apply the existing 18 migrations and verify readiness,
live two-user/reconnect flows and scheduler. No hosted database, migration or complete
beta journey is claimed. Backups, timely scheduler and real-device checks remain required.

## Previous release: Russian interface and Intavro branding

Starting/published baseline: `447fb2ec96ea9b6ed19198ee5a234d39b2af4f14` (closed-beta
candidate, 684 tests/77 files, 56 browser cases). The public website is now **Intavro**:
Russian screens, forms/options, accessibility copy, validation/error/empty states,
privacy/recovery/delete UX, chat, disclosures, planning/results/voting, notifications/
generic push, moderation, metadata and date formatting. New profile/seeking language
inputs default to `ru`; existing user data and language choices remain unchanged.

- Licensed local DejaVu fonts render Russian share images offline, including em dash.
- Known activity display labels and optional AI human suggestions are Russian;
  activity keys, enums, API identifiers and deterministic matching stay unchanged.
- Internal Veya cookies, storage/events, recovery model, SQL/listener/lock namespaces,
  repository and invite links retain compatibility. No migration was added; applied
  migrations 0001–0018 are unchanged.
- Independent read-only review reproduced one Important regression: changing engine
  explanations changed legacy fingerprints and could erase votes. Engine bytes remain
  identical to the starting HEAD; Russian results are projected from structured facts
  outside the versioned engine. Native PostgreSQL regression preserves old fingerprint,
  suggestion keys/revision and yes votes, including Russian frozen/expired presentation.
  Browser transport fallbacks and share-image punctuation findings were corrected.
  Re-review found no remaining Important/Critical issue in the diff. See
  [review](docs/russian-interface-review.md).

**Local evidence, Node 24.19.0:** fresh `npm ci` and full `npm run check` PASS; lint
zero warnings, strict TypeScript, **689 tests / 77 files** (+5 meaningful cases),
production build PASS. Final full `npm run test:e2e`: **56/56 PASS**, 28 desktop +28
mobile including 320px, no retries. `npm audit --json`: zero vulnerabilities. Both
normal Docker target builds PASS; non-root UID1000 web/operations smoke PASS. Isolated
PostgreSQL18 smoke: 18 migrations/idempotence/checksums, concurrent workers, readiness,
actual no-store Cyrillic OG PNG, retention preview and backup/empty-database restore PASS.
Earlier translation selector failures were corrected without loosening behavioral
assertions. A container smoke hit local VFS ENOSPC; only old task-owned images/cache
were removed and the complete database smoke reran successfully.

**Remote evidence for this change: PASS.** Source
`394624bf89c3d739ed3f36b7e2ba6859954bf8ec`, [run 37155067183](https://github.com/Kqway/veya/actions/runs/37155067183):
quality job `111296666358` and container job `111296666210` both SUCCESS. Hosted
Node24 checks independently reproduced 689 tests/77 files, audit0 and 56/56 desktop/
mobile first-attempt E2E; normal images/non-root and isolated PostgreSQL/OG/worker/
backup/restore smokes PASS. This follow-up records verified source evidence; historical
release evidence below remains separate. No production deployment/domain purchase occurred. Intavro is
an invented international brand candidate: available GitHub repository-name search
returned no match, but public search was blocked here. Domain/trademark availability
still requires owner verification; no universal/legal uniqueness is asserted.

## Previous release: Closed Beta Readiness

The independently verified starting HEAD is `b3b2dcd8dffc6ab8a9276774532343a55df47673`.
Clean baseline: npm ci/check/build passed, **586 tests / 68 files**, **48/48 desktop/mobile
Playwright**, audit zero vulnerabilities. The current pass preserves Phases 1–9 and adds:

- Transactional typed-confirmation profile deletion, minimized irreversible tombstones,
  invalidated recovery/session/delivery access, own-content erasure, peer closed history
  and immutable moderation evidence; linked-plan participation erased for each owner.
- Migration **0018_social_profile_deletion.sql**; applied 0001–0017 remain unchanged.
- Centrally validated server-only signup/seeking/read-only controls. Maintenance stops
  stateful discovery and workers; existing results/connections read without domain writes;
  explicit safety/deletion/revocation and liveness/readiness remain available.
- Bounded signal-aware worker/CLI lifecycle, concurrent lease ownership, safe failure logs,
  operator-only aggregate queue status, checksum verification and protected PostgreSQL
  service-based backup/empty-database transactional restore scripts.
- Clearer action-first onboarding, memory-only Veya Key copy/acknowledgement/recovery,
  explicit deletion UI and extensible deterministic RU/EN normalization for beta activities.
- New real-UI two-user chess→live chat→linked plan→availability→votes→confirmation/inbox
  journey, recovery/deletion and two-pair incognito privacy journeys on desktop/mobile.
- Practical deployment, scheduler, backup/disaster-recovery, readiness and host/device
  verification documentation. No production deployment was performed.

Independent review found two Important issues: maintenance GET mutations and a lost
linked-plan reference after first-owner deletion. Both were reproduced with native
regression tests, fixed and independently re-reviewed. See
[closed-beta review](docs/security-closed-beta-review.md) for evidence and limits.
No additional Critical/Important issue remains in that reviewed scope.

**Verified application evidence before dependency follow-up, 2026-10-02 (Node 24.19.0):**

- Clean `npm ci`: PASS. `npm run check`: zero-warning lint, strict TypeScript,
  **681 tests / 76 files** (+95 tests / +8 files over the independently checked
  Phase 9 baseline), production build PASS.
- Full final `npm run test:e2e`: **56/56 PASS**, 28 desktop +28 mobile, no retries,
  including the complete voted plan, recovery/deletion, two-pair privacy journey
  and socket-reset/no-mutation-replay regression (+8 cases over the Phase 9 baseline).
- `npm audit --json`: PASS, **zero known vulnerabilities** at verification time.
- The 320px normal-click journey reproduced a touch hover-transform oscillation;
  fine-pointer-only hover transforms corrected it. Full gates also exposed missed
  clicks during global smooth form scrolling; immediate scrolling and an explicit
  selected-interval readiness assertion preserve overlap/UTC checks and normal clicks.
- Independent review: two Important findings reproduced, corrected and re-reviewed;
  targeted independent verification **24 tests / 4 files PASS**. No unresolved
  Critical/Important finding in the reviewed scope; see the separate report.
- Applied migrations 0001–0017: all original SHA256 checksums unchanged. Actual
  isolated PostgreSQL smoke applied all 18 migrations, reran idempotently, verified
  schema, concurrent candidate processing/dedupe and no automatic Interested,
  worker/retention previews, ready/unavailable states and protected backup/restore.
- Local runner and operations builds before the browser follow-ups: PASS;
  fresh UID1000 health/missing-DB migration/worker smoke PASS. Runner `sha256:d138b6e6b905c5e52a72957690a5fe8ce5d0342e3432676a95e0eeffbdf7fe7f`;
  operations `sha256:7c3a5b0927470932aebf148a929baed9b02d93ed8dc0e7acf93d79354da71249`.
  Docker Hub exhausted the workspace's anonymous pull budget; local builds used
  the identical cached official Node24 base digest `0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`
  through a temporary pinned Dockerfile. At that checkpoint the repository Dockerfile was unchanged.
  Preliminary runs interrupted by disk exhaustion were discarded; task-owned stale
  vfs image/cache artifacts were removed and complete gates repeated successfully.
  Actual PostgreSQL/backup smoke is isolated and uses no development/production DB.
  The smoke wrapper now reuses one operations filesystem: concurrent workers are
  still independent Node processes/pools, and all database/dedupe/restore assertions
  remain unchanged. The revised full PostgreSQL smoke passed locally.

**Verified hosted application evidence before dependency follow-up, independently observed 2026-10-03:**

[Run 37063414137](https://github.com/Kqway/veya/actions/runs/37063414137), source
`95187bef1011b47fa40a6606019897e0508e5fe4`, completed both jobs successfully.
Hosted Node24 clean npmci/lint/types/**681 tests/76 files**/production build/audit0,
**56/56 first-attempt desktop/mobile browser cases** (2.4min), both normal repository
Docker targets, non-root smoke and actual isolated PG18 migrations/concurrent workers/
readiness/protected backup-restore passed. Current source also passed the final local
check/audit and full56/56 browser gate (3.7min) after the last logging correction.
The following commit `c9468dd` only updated documentation. Check the current published SHA on the
[workflow page](https://github.com/Kqway/veya/actions/workflows/ci.yml) before rollout.

Discovery now distinguishes load failure from no activities and offers explicit retry.
Delayed responses cannot restore deleted profile state. Background reads in discovery,
connections and chat have separate bounded locks; manual actions and blocks invalidate
old state. Deferred-read regressions prove Interested/Accept/Send stay actionable,
perform one explicit POST and cannot be overwritten by stale results. UI29/29 and
independent follow-up reviews passed. Exhausted LISTEN recovery logs one fixed event
with numeric counters only; its existing retry test reproduced RED then GREEN, and
hub/API-logging targeted5/5 passed. No production limits/assertions were weakened.

**Dependency advisory follow-up, 2026-10-03:**

The documentation commit `c9468dd` failed [run 37099580326](https://github.com/Kqway/veya/actions/runs/37099580326)
at audit: a newly reported High advisory, GHSA-vfj7-8cjw-p6xm, affected `braces`
through Next ESLint's development-only fast-glob/micromatch chain. Native681/build
and both container/database gates passed; browser execution was skipped after audit,
not counted as a browser pass. Earlier audit0 results remain historical observations.

No patched braces release was available. A narrow, honestly named repository adapter
replaces only Next ESLint's directory-root glob dependency using pinned tinyglobby.
Recursive directory expansion is disabled to preserve root selection; excessive
brace nesting is rejected before parsing. All Next ESLint rules remain enabled;
Next/React were not downgraded, and audit was not waived. `.npmrc` and Docker's
pre-install COPY make the file dependency reproducible in clean/container installs.
The actual Next utility's default/literal/wildcard/brace/array roots and nesting
guard pass3/3; the guard reproduced RED first. Independent read-only re-review
confirmed the installed adapter, removed braces/micromatch, audit0 and no new
Important/Critical finding in this development-only scope.

Fresh Node24 plain `npm ci` and `npm run check` passed: **684 tests /77 files**
(+98 tests/+9 files over Phase9), lint/types/build PASS. Full desktop/mobile E2E
passed **56/56 on first attempt** (3.6min); fresh `npm audit --json` reports0.
Both final local normal-Dockerfile builds passed, including the scoped clean install.
Runner `sha256:5276c8f4de76d371d918704c04fca7555e7dc6ad9a5ef2d419d4cace261c5a6f`;
operations `sha256:ab21e52c980e7864de7949e8a4cabea9071596e153c886cb657a4982897be937`.
Non-rootUID1000 and full isolatedPG18 migrations/idempotency/checksums/concurrent
workers/readiness/backup-restore smokes passed. Preliminary local runs using incorrect
workspace proxy/CA configuration and a smoke interrupted by VFS disk exhaustion
were discarded; corrected proxy/CA secret mounts and removal of explicitly identified
old Veya cache IDs preceded the complete successful runs. No production data was used.

Exact published source `75619675f57e9a7eca07b90b37793b8c7805e3b7` passed
[run 37101005678](https://github.com/Kqway/veya/actions/runs/37101005678), both jobs,
independently observed2026-10-03. Hosted clean npmci/lint/types/**684tests/77files**/
production build/audit0 and **56/56 first-attempt desktop/mobile E2E** (2.6min) passed.
Both normal repository Docker targets, non-root and actual PG18 migration/concurrent
worker/readiness/protected backup-restore gates also passed. Applied0001–0017 hashes
remain unchanged. This final follow-up only records evidence in documentation;
check its exact published SHA on the workflow page before rollout.

**Earlier beta gate history (superseded by the evidence above).**

**Hosted CI evidence is separate.** Verified Phase 9 starting HEAD `b3b2dcd` passed
[run 36990321453](https://github.com/Kqway/veya/actions/runs/36990321453).
Beta HEAD `6f1f0ed` [run 37027471223](https://github.com/Kqway/veya/actions/runs/37027471223)
passed both actual Docker builds, non-root and real PostgreSQL/worker/backup smoke,
plus lint/types/673 tests/build/audit. Its browser gate failed (53 passed): the real
response auditor's Node transport hit ECONNRESET on an idle GET, then the retry
encountered retained fixture posts. A socket-reset regression reproduced RED, then
GREEN with a bounded GET-only transport retry and no mutation replay. Disjoint
future windows isolate retry/repeat fixtures without relaxing exact candidate,
privacy, blocking or UTC assertions. The affected desktop journeys passed twice.
A fresh exact-SHA hosted workflow was required after that correction;
local results never imply hosted PASS. Later runs are recorded below.
At `b41c15d`, [run 37056311245](https://github.com/Kqway/veya/actions/runs/37056311245)
was green but one desktop journey timed out and passed on retry (55 first-attempt
passes plus one flaky). That is not accepted as final release evidence. CI now
allows no browser retries and always retains verification logs/traces; explicit
audit/cleanup steps make a future timeout diagnosable. The prior hosted trace was
not uploaded because its job was green. Installing the identical hosted browser
locally was blocked by the workspace network's CDN policy (403); local checks use
system Chromium151, and hosted checks use installed Chromium153. This failure is
recorded, not reported as a successful browser installation or equivalent engine.
Three valid sequential desktop journey/recovery pairs passed (6/6) without retries.
An exploratory fourth repeat selected day7, outside the unchanged picker horizon;
its explicit validation rejection was diagnosed as invalid stress-fixture input,
not treated as a passing run or a reason to relax the product's time bounds.
At `d9b6e0a`, strict [run 37057659178](https://github.com/Kqway/veya/actions/runs/37057659178)
passed container and native/build/audit gates, but browser execution failed (55/56).
The retained trace showed HTTP429/Retry-After5: parallel independent journeys exhausted
unchanged global production read budgets. Journeys now run serially; simultaneous
actors within realtime cases and independent worker processes remain concurrent.
Production limits, privacy assertions and first-attempt release gates remain intact.
Discovery now distinguishes failed activity loading from a genuinely empty list and
provides explicit retry. Independent review found and confirmed correction of a P2
late-response/deletion UI race; generation guards discard obsolete results/errors.
Five new UI regressions pass (26/26 targeted). Fresh npmci/check/audit on corrected
sources passed: **678 tests /76 files**, zero-warning lint/types/build, audit0.
The corrected full browser/hosted gates were pending at that checkpoint; their
later outcomes are recorded below, separately from earlier source verification.

At `10da84f`, [run 37060563837](https://github.com/Kqway/veya/actions/runs/37060563837)
passed both hosted jobs:678 tests/76 files,56/56 browser cases on their first attempt,
both Docker targets and the non-root/actual-PG/worker/backup-restore gates. A parallel
local full browser run nevertheless reproduced a separate realtime/Interested race
(29 passed,1 failed,1 interrupted,25 not run after stopping to diagnose). Its trace
showed a background GET changing the foreground busy/layout state during the click,
with no connection POST. That failed run is not accepted as local release evidence.
A deterministic deferred-background UI regression reproduced RED before the fix.
Background reads now use a separate bounded lock; manual actions/selection changes
invalidate their stale results. UI27/27 and independent read-only re-review passed.
Fresh corrected check passed **679 tests/76 files**, lint/types/build and audit0;
its full local browser and hosted gates were pending at that checkpoint; see the
subsequent recorded outcomes.

At `d872337`, [run 37061389126](https://github.com/Kqway/veya/actions/runs/37061389126)
passed679 native tests/build/audit and both container/database gates, but hosted
mobile Send was lost during a background read (55/56). Local full execution also
finished55/56: mobile Accept clicked without a POST during a connection refresh.
Neither run is accepted as final evidence. Two deferred-read UI regressions
reproduced these actions being disabled; foreground/background read separation and
generation checks now cover Connections and Match as well. UI29/29 and independent
read-only re-review passed. Corrected complete check: **681 tests/76 files**,
lint/types/build and audit0. Its full local/hosted gates were pending at that
checkpoint; subsequent verification follows. No failed run is discarded here.

At `353de4f`, [run 37062608458](https://github.com/Kqway/veya/actions/runs/37062608458)
passed both hosted jobs: **681 tests/76 files,56/56 first-attempt desktop/mobile**,
production build/audit0, both actual Docker builds, non-root and real PG/worker/restore
smokes. The same social source passed local full56/56 with no retries (3.8min).
The final observability check reproduced missing LISTEN exhaustion logging RED, then
added one fixed numeric-only event. Independent review and targeted5/5 passed;
current full check passed681/76 plus lint/types/build/audit0. The final browser and
hosted verification of that logging addition is recorded above.

No production HTTPS/database/scheduler/device verification has occurred.

Owner work remains HTTPS hosting/domain, verified PostgreSQL, moderator credential and
human response policy, worker/backup scheduling, encrypted off-host backups and a real
restore rehearsal, retention policy, actual iPhone/Android checks and optional VAPID/AI.
See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for variables and the sequential rollout.

## Historical baseline: Phase 9A–9L

**Status: production release candidate implemented; locally and remotely verified, 2026-10-02.**
Baseline was independently checked at `d5f3b30`: 398 tests/43 files and 38/38
Playwright cases. Phase 9 preserves that coordination/Intent Network flow and adds:

- Recipient-authenticated SSE through PostgreSQL transactional events and LISTEN;
  bounded subscriptions/retries, offline/reconnect recovery from persistent APIs.
  Requests, accept/decline, matches, chat, blocks, notifications and linked plans update
  without Refresh. Events contain safe hints only, never internal identities.
- Private notification inbox/unread count, transactional dedupe, explicit opt-in Web
  Push with generic encrypted payloads, durable bounded delivery/retry jobs and
  reminders for confirmed linked plans. Push is optional; denied/unsupported browsers
  keep the core flow. Explicit worker scheduling is required for delivery/reminders.
- Secret-protected human moderation queue, immutable minimal report-time evidence,
  open/reviewing/resolved/dismissed states, append-only audit and server-enforced
  seeking/connection restrictions/suspension. Recovery does not remove restrictions.
- Atomic PostgreSQL multi-instance rate budgets, hashed credential buckets, a global
  profile-creation budget, bounded storage and fail-closed admission. No IP headers or
  browser fingerprinting. The existing twenty discovery contexts/day limit remains.
- Eight optional fixed server funnel events and aggregate cohort reporting without
  raw text, names, location, messages, contacts or client-supplied identities.
- EN/RU extensible activity normalization, batched indexed discovery/message reads,
  durable bounded future-candidate jobs and honest cold-start UX. Candidate notices
  require a scheduled worker and never send Interested or create matches automatically.
- Node 24 CI with native isolated PostgreSQL, production build, desktop/mobile
  Playwright and failure artifacts; E2E explicitly overrides inherited DB/AI/push
  settings. HTTPS/TLS validation, pool limits, liveness/readiness, safe structured
  logging, bounded shutdown and non-root standalone/operations Docker targets.

**New migrations:** `0011_social_events.sql`, `0012_social_notifications.sql`,
`0013_social_moderation.sql`, `0014_shared_rate_limits.sql`,
`0015_social_query_indexes.sql`, `0016_social_funnel.sql`, `0017_candidate_jobs.sql`.
All original 0001–0010 SHA256 checksums were independently compared with the clean
baseline and are unchanged. New tables retain server-only RLS, constraints and indexes.
Retention now preserves open/reviewing evidence and cleans bounded release queues,
events, notifications, expired admin sessions and limiter buckets explicitly.

**Final local evidence (2026-10-01–02):**

- `npm ci`: PASS at the verified baseline; updated dependency lock also installed
  successfully by the final clean Docker build.
- `npm run lint`: PASS, zero warnings. `npm run typecheck`: PASS.
- `npm test`: **586 tests / 68 files PASS** (+188 tests / +25 files over baseline).
- `npm run build`: PASS on final application sources; non-root Node 24 Docker build
  also PASS, final runner image `sha256:18ba726388d42793dceaddae137fb5f2ea9fbb8812a8f09dce853c47ec4bac4e`.
- `npm run test:e2e`: **48/48 PASS**, 24 desktop +24 mobile (+10 cases), including
  simultaneous users, live Interested/accept/chat/plan/block/inbox, offline reconnect,
  denied/unsupported push, moderator suspension and 320px/reduced-motion cold start.
- `npm audit --json`: PASS, **zero known vulnerabilities** at verification time.
- Docker smoke: non-root UID1000, container healthy, `/api/health`200 and
  `/api/ready`503 when no database is configured, as intended. A subsequent real
  operations smoke reproduced owner-only checkout files unreadable to node; builder
  COPY now assigns ownership explicitly. Both migration and worker CLIs reach their
  safe missing-DB failure as node. A separate CI job reproduces restrictive file
  permissions and executes the actual runner/operations smoke script.
- Separate read-only security/privacy review: six Important findings reproduced,
  fixed and re-reviewed, with regression tests; no unresolved Critical/Important
  finding in reviewed scope. See [review](docs/security-phase9-review.md) for evidence
  and limits. This is not a claim of absolute anonymity or external penetration testing.
- **Remote Phase 9 CI: PASS**, separately observed on 2026-10-02 at 09:21 UTC.
  [Run 36988674863](https://github.com/Kqway/veya/actions/runs/36988674863), source
  SHA `b7e5d98f9f23136e0652c6619329fca95e0f5a22`: both quality/container jobs succeeded.
  Hosted Node 24 npmci/lint/types/**586 tests /68 files**/build/audit and
  **48/48 desktop/mobile E2E** passed, with no flaky/retry result. Both Docker
  images built and restrictive-permission non-root smoke passed. This is remote
  evidence for that exact source SHA, not evidence of a production deployment.
  The documentation follow-up `1b5e7a6` also passed both jobs in
  [run36989554676](https://github.com/Kqway/veya/actions/runs/36989554676).
  Final alignment changes documents only; its own exact pushed SHA is checked
  again by CI and the final engineering report.

**Hosted portability corrections:** run `36920188548` exposed missing rg,
headless clipboard denial and setup navigation before Interested acknowledgement.
Actual artifact/trace review confirmed these causes; portable grep, explicit native
clipboard permission/content assertions and acknowledgement-before-navigation fixed
all cases without removing assertions. Local affected cases4/4 and full48/48 passed
on 2026-10-02 before the successful hosted rerun above.

**Operator requirements:** configure an HTTPS origin/host and verified-TLS PostgreSQL,
apply migrations with a server-only role, set a random moderator secret, configure
session-mode LISTEN and proxy streaming, schedule `social:process` and reviewed
retention, verify backup/restore and readiness, and check the target release CI. Real HTTPS
push-provider delivery requires optional VAPID configuration/browser opt-in and has
not been exercised locally. OpenAI, Web Push and aggregate analytics are optional;
Redis, an external realtime provider, email/SMS and paid AI are not required.
See [deployment](docs/DEPLOYMENT.md) and [checklist](docs/RELEASE_CHECKLIST.md).

**First launch metrics:** seeking→candidate rate; seeking→Interested rate;
Interested→accepted match rate; match→first conversation rate; match→confirmed plan
rate. Measure these cohort transitions, not page views; a confirmed plan alone does
not establish that a real-world meetup occurred. `npm run analytics:funnel` emits
bounded aggregate counts when analytics is enabled.

## Phase 9 commits

- `ba5f4ef` — phase-9a: release configuration and database foundations
- `0ce1c56` — phase-9e: shared abuse protection
- `90b4891` — phase-9b: authenticated realtime delivery
- `9a5e89d` — phase-9c: notification inbox and opt-in push
- `ca228bb` — phase-9d: protected human moderation
- `4d95f0e` — phase-9h: activity normalization and bounded discovery
- `9a2e364` — phase-9g: durable future-candidate matching
- `5efc80e` — phase-9f: live social actions and private funnel metrics
- `f61495e` — phase-9j: deployment lifecycle and non-root container
- `972d011` — phase-9l: launch UX and desktop/mobile journeys
- `a93568f` — phase-9k: security review and release evidence.
- `3204643` — phase-9a: enforce dependency audit in CI.
- `ecff806` — phase-9j: verify non-root operational images.
- `b7e5d98` — phase-9a: make browser and container gates portable.
- `1b5e7a6` — docs: record verified Phase 9 release candidate.
- Final documentation alignment: `docs: align current Phase 9 deployment boundaries`.

## Historical Phase 8 baseline

**Historical Phase 8 status: Intent Network v1 implemented (2026-10-01).** Original Phases1–7
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

## Historical Phase 8 Architecture

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

## Phase 8 Decisions and Privacy Limits

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

## Historical Phase 8 Test Evidence

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

## Historical Phase 8 Production-only Work and Known Limitations

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

## Historical Phase 8 Handoff Notes (superseded by the Phase 9 release above)

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
