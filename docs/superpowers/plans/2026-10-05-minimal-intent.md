# Minimal intent implementation
Spec docs/minimal-intent-product-design.md. Reuse all architecture; new additive0020
follows pending0019. No paidservice/dependency/productionmutations, oldmigrationedits.

### Task 1: Complete Profile Worlds foundation
Fix previous remaining editorSPA unsaved guard/currentintentexpiry, tests/labels.
Own profile-space files (except shared service changes coordinate) and review.
Root coordinates final full gates with all newstage code. Keep eightworlds.

### Task 2: Strict conversational domain/parser
Create src/features/intent-product/schema.ts parser.ts compatibility.ts. Shared
contract in .superpowers/sdd/minimal-intent/contract.md. Pure parse createsdraft/
oneclarification from owntext, understandscommands andpreferences, RU/EN Dota +
generalactivity. OptionalAI abstraction appropriate boundedowntextonly. UnitTDD.

### Task 3: Additive persistence and orchestration
0020 migration search/lobby/offer/room/preference/job tables, service/lobbies/rooms/
worker using existingseeking + matching + sessionslocks. Authorization, explicit
consent, lastslotrace, expiry/quiet/block/suspend/delete/report. NativepgTDD.
Services consumed by rootHTTPboundary. No directory or fake members/progress.

### Task 4: Minimal UI and migration-compatible legacy routes
New main composer minimalonboarding/preview/active/searchcommands/offers, people
rooms, roomplainchat, preferences. Legacy home /plan preserving coordination and
all assertions (navigation targets updated only). Russiandarkpremium320/accessibility.
Shared safeDTO via contract; root HTTP APIs, existing notifications/realtime/
worker integration, safety/report/deletion/hooks and analytics integration.

### Task 5: Journeys, review, full gates and docs
ExistingprofileE2E6cases plus newminimal-intentdesktop/mobilecases, oldjourneys full
preserved. Independentsecurityrace reviewfixedwithtests. Fullcheck,E2Eordinary+
Vercel,audit, appliedSQLhashcomparison. README/progress/API/deploymentguide exact
results includingmigrationsequence and ownerproductionsteps. Normal logicalcommits.
