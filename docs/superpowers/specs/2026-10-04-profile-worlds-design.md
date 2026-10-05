# Intavro Profile Worlds

The owner requests a premium Russian mobile-first personal space, eight controlled
worlds, live customization and richer action-first discovery without weakening
OPEN/PRIVATE/INCOGNITO or existing coordination. Implementation is explicitly
authorized without intermediate confirmation. Baseline HEAD ae68914.

## Architecture

Keep social identity/recovery DTOs unchanged. Add a server-only profile-space
repository/service, pure customization validation and projections, and React
presentation that receives only permitted DTOs. No directory or stable public
profile key. Self: /profile and /profile/edit. Context views:
/profile/discovery/[handle], /profile/connection/[requestKey],
/profile/match/[matchKey]. GET/PATCH /api/social/profile/space; GET
/api/social/profiles/{discovery|connection|match}/[key]. All retain session,
same-origin, rate, no-store and sorted-profile lock reauthorization boundaries.

0019 creates social_profile_spaces keyed by internal profile FK, bounded validated
JSONB and RLS without client policies. Existing profiles get a default without
mandatory user action. Deletion removes customization; a DB trigger prevents
inserting/updating a space for a deleted profile. Applied 0001–0018 remain intact.

## Controlled customization contract

world: minimal, midnight, glass, cozy, cyber, manga, y2k, monochrome.
accent: coral, mint, violet, amber, blue. avatar: orbit, arch, spark, grid.
status <=60, tagline <=120; interests <=8 distinct strings of <=30; goals <=3
strings of <=80; selectedActivities <=6 normalized activity keys <=64;
intentPostKey nullable existing owner post opaque key.
Blocks: intent, activities, interests, goals. enabledBlocks and blockOrder unique,
bounded; order contains all four. Visibility per status/tagline/each block:
self, connection, everyone. Default status/tagline/interests/goals/activities self;
intent everyone. Full strict update, <=16KiB existing body cap. No arbitrary CSS,
HTML, external image URLs/fonts, analytics or logging of user customization.

## ProfileSpace DTO

identity {alias,avatarSeed}; audience self|stranger|connection;
presentation {world,accent,avatar}; nullable status/tagline/currentIntent;
activities [{activityKey,activityLabel,count}], interests string[], goals string[];
blockOrder visible block enums; action {kind:seek|interest|connections|chat|none,
key:string|null}; customization only on the self DTO; intentOptions [{publicKey,
activityLabel}], activityOptions [{activityKey,activityLabel,count}] only on self.
Current intent: {activityLabel,interactionMode,format,timeHint:string|null}.
Never expose UUIDs, exact time windows, raw seeking text, precise location,
contact disclosures or other matches. Counts mean created seeking posts, never
attendance or completed meetups; render explicitly as 'заявки'.

## Privacy and authorization

Self sees saved settings and authentic capped post history. OPEN contexts respect
per-field visibility; PRIVATE stranger sees context activity and safe preset only,
no arbitrary text/history/interests. Connection fields need explicit visibility.
Any profile, post or persisted pair INCOGNITO strength suppresses ALL global
customization and history, even after match. Derive a preset only from the already
safe random pair avatar seed; never from internal UUID. The scoped activity itself
is permitted. No profile existence oracle: foreign handles/requests/matches,
blocked/suspended/deleted/expired/passed discovery are generic unavailable404.
Declined/expired requests are unavailable. Accepted request goes to existing chat;
pending goes to connections. No duplicate request CTA. Match views require active
match and unblocked pair. Discovery rechecks future deterministic compatibility,
block/pass/request history under locks, bounded data.

Discovery card adds a safe {world,accent,avatar} fragment, supplied by the same
privacy layer, and links to its existing context profile. Existing Interested,
chat/planning and recovery UI controls remain available.

## Presentation

Eight distinct scenes via local CSS presets: editorial Minimal, dark Midnight,
frosted Glass, warm serif Cozy, grid Cyber, halftone Manga, chrome Y2K and sharp
Monochrome. Accent controls remain constrained and contrast-safe. Local SVG
avatar variations. Strong cover, large alias, current action and reordered blocks.
Desktop controls/preview side by side, mobile Settings/Preview switch. Accessible
labels, keyboard reorder controls, focus, loading/retry/empty/unavailable states,
320px containment and reduced motion. No new dependencies.

## Verification

TDD for validation/privacy and native PostgreSQL authorization/constraints/deletion/
recovery/stale contexts/incognito pair isolation; DOM editor tests; desktop/mobile
browser journey and320px screenshots. Separate read-only review. Full check,
E2E ordinary+Vercel mode and audit. Local results separate from hosted verification;
no automatic production publish of code requiring unapplied0019.
