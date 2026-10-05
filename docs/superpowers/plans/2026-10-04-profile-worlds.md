# Profile Worlds implementation plan

Spec: docs/superpowers/specs/2026-10-04-profile-worlds-design.md
Global constraints: applied migrations immutable; no directory, remote assets,
new dependency, credential/private logs, automatic disclosures or production
migration/deploy. Keep existing identity DTO and original scheduling untouched.

### Task 1: Pure profile domain and projection
Create src/features/profile-space/schema.ts (strict customization/defaults/types),
projection.ts (explicit whitelisted DTO projection using existing safe identity,
audience/effective privacy/context activity, visibility/order), worlds.ts
(Russian preset labels). Unit validation/projection RED then GREEN. Root owns
these files. Profiles remain compatible; avatar choices do not replace identity.

### Task 2: Persistence, authorization, HTTP and discovery projection
Create0019_profile_spaces.sql and service.ts using Task1 contract. TDD native
PostgreSQL. GET/PATCH profile/space and GET profiles/context/key within current
handler. Maintain sorted lock/reauthorize, all-state privacy, no enumeration.
Recheck deterministic candidate compatibility before discovery-profile reads.
Discover cards get presentation fragment from same projection logic without
unbounded queries. Deletion erases new table. Cover actor/outsider/recovery/block/
suspension/deletion/expired/pass/incognito per-post and persisted-pair modes,
SQL constraints and full DTO leak scans. Backend implementer owns these files,
its integration tests and existing social backend HTTP/discovery/deletion edits.

### Task 3: Presentation primitives and editor
Create ProfileScene and ProfileEditor in src/features/profile-space/components,
worlds.css eight distinct scenes, local avatars, compact preview card. Read only
safe DTO. Editor takes self DTO and onSave(settings) callback, live preview,
mobile settings/preview, validation, field visibility, block reorder/enable,
activity and existing intent selection, unsaved guard, loading states. Tests DOM
keyboard/live preview/validation/save/320-relevant composition. Frontend implementer
owns only these presentation files/tests; root integrates routes/navigation/cards.

### Task 4: Route integration and browser journeys
Root adds profile screens/routes static noindex metadata, own registration fallback
existing ProfilePanel, editor API save/retry and unavailable states; context CTA
interest/connection/chat respecting server DTO. Add discover/full profile links,
chat/request/profile navigation preserving existing controls. E2E two users OPEN
permitted fields then INCOGNITO suppression, stranger/connection, editor worlds,
block/delete/stale errors,320px desktop/mobile. All assertions remain meaningful.

### Task 5: Independent review, full gates, documentation
Independent read-only privacy/auth/performance/a11y review, fixes with regressions.
Run baseline/final npm run check, full ordinary+Vercel E2E, npm audit. Verify old
migration checksums unchanged. README/design/API/release/progress exact evidence,
known global customization Incognito restriction, truthful counts, deployment0019
required. Logical commits; don't push migration-dependent build straight to live
production before authorized deployment/migration coordination.
