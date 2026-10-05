# Veya redesign system

Date: 2026-10-05. The primary experience is intent → execution → result.

## Audit and direction

The old global shell contains Intavro branding and social navigation. Imported
product.css uses body:has(.intent-product) to recolor the whole application dark;
Profile Worlds has separate decorative tokens. New goal screens use a coherent
global shell and reusable goal primitives. Legacy worlds/manual social screens
remain secondary, with their existing functional components; remove global
body:has overrides that make a new page look embedded inside the old product.

Choose a quiet light composition: warm ivory canvas, near-black type, muted stone
secondary text, restrained forest-green execution accent. No purple, gradients,
large sidebar or dashboard tables. Wordmark `veya` with a small orbital mark;
top navigation Goals / Activity / profile, 3–4 mobile controls. Footer is a small
demo disclosure, not marketing. All primary copy is Russian and concise.

## Tokens and primitives

Typography uses local system sans for body and a restrained serif for the main
intent question; headings 32–64px responsive, body16–18px, labels13–14px. Line-height
1.15 headings,1.55 body. Spacing4/8/12/16/24/32/48/64/96px; radii8/16/24px/pill.
Canvas/surface/raised hierarchies use color and whitespace with sparse hairlines.
Buttons primary dark, secondary light, text, and destructive;44px touch targets.
Visible keyboard focus ring, disabled/busy states, aria-live status/errors,
accessible labels and semantic timeline lists. Reusable GoalStatus, GoalCard,
Timeline, MoneyProgress, ApprovalPanel, EmptyState, Skeleton and ErrorState.
Motion opacity/translate only,140–240ms; reduced motion disables it.

## Screens

Home is almost empty: wordmark, `Что должно произойти?`, a large textarea and
understated examples. Default example `Заработать 30 000 ₽`. Send creates a goal
without a complex goal form. When identity is missing, preserve the phrase and
ask only for existing required pseudonym/adult/privacy consent. No fake seed goals.
Below the composer, compact live-process rows show title, verified progress and
status. Demo disclosure explicitly says payments and clients are simulated.

Goal detail: large human title, verified money progress, status, `Сейчас`, next
actions and a compact timestamped human timeline. Waiting says Veya will resume
automatically. Approvals show exact action/price/consequence, approve/decline;
no raw technical logs or chain-of-thought. Completed screens celebrate actual
stored confirmed demo events, not elapsed timers. Artifact links open owner-only
stored content. Pause/resume/cancel are calm, explicit controls.

Settings/profile: Identity, Capabilities, Connections, Autonomy, Notifications,
Privacy. Preserve recovery-key handling, explicit profile deletion and privacy
editing through existing components/APIs. Worlds and old coordination remain
secondary links. Connections: `Что Veya умеет использовать`, functioning demo
connector toggles plus honest unavailable GitHub/email/calendar. Autonomy page
shows auto read/draft, bounded communication and always-approved financial/legal/
destructive actions; saves bounded policy to authoritative state.

Activity combines owner-only persisted meaningful goal events. New primary routes
`/`, `/goals/[key]`, `/goals/[key]/approvals/[key]`, `/activity`, `/connections`,
`/settings`, `/autonomy`, `/profile`. Old connections move to `/network/connections`;
old home moves to `/network`. Keep old invite/match/room/search routes functional.

## Responsive and visual gate

Fluid padding16–64px, content max1080px and reading width760px. Composer and
approvals stack at narrow widths; money typography wraps without overflow. Verify
320,375,390,768 and1280px with actual browser screenshots, including all goal
states, empty/error/loading, settings/connections/autonomy and reduced motion.
Inspect screenshots before claiming redesign complete. Build alone is insufficient.
