# Veya final MVP phases

Latest user instruction, “Закончи до конца”, authorizes completing both remaining
phases in this run, superseding the earlier one-phase stopping rule. Preserve the
working repository, guest privacy and deterministic scheduler. Separate prescribed
Phase 6/7 commits and authorized fast-forward publication; no deployment without a
requested host. Native execution/TDD, one whole-change review per phase. Existing
autonomous authority overrides skill approval pauses and intermediate commits.

## Phase 6 — consumer experience and sharing
Incremental polish chosen over a redesign or additional wizard steps. Compact the
landing hero while creating, generous touch targets at 320px, clear step cues,
selection feedback, subtle reduced-motion-aware transitions and useful loading UI.
Focus the join form when opened; place participation before sharing for recipients.
Retain editable optional details and all existing manual/AI failure paths.

Share actions remain Copy link/Telegram/native with canonical local-origin URL,
public organizer-specific copy, explicit busy/success/fallback, quiet cancellation
and selectable URL. Invite metadata/image use only public creatorName and fixed
copy: “Add your availability and Veya will find what works for everyone.” Never
fetch or expose participant data, intent text, hints, notes, IDs or bearer cookies
in previews. Invalid/closed/unavailable invites get generic preview; all invite/
result metadata remains noindex, images no-store. Built-in ImageResponse, no assets
or external fonts. Metadata preserves public Unicode names; images use bounded
printable ASCII names or generic copy for other scripts/emoji, guaranteeing offline
rendering without Google Fonts/Twemoji. Preview SQL selects only name/effective
status and never reads private columns or participant tables. Bounded new_intent_from_invite accepts invite/result surfaces
only and fires from a repeat-plan CTA, never carries text or identity. CTA after
joining and after voting/confirmation returns to landing without query parameters.

## Phase 7 — release preparation
Audit guest ownership, origin/body/JSON handling, timestamps and concurrency, AI
privacy/limits/fallback, lifecycle, errors and mobile journey. Add reasonable
bounded rate limiting through a replaceable server abstraction: global limits for
anonymous/AI abuse plus hashed guest limits; no client-trusted forwarded IPs.
Limits must stop expensive work, return safe 429 with Retry-After and preserve
manual fallback. Document process-local versus distributed host guarantees.
Add security headers compatible with Next/inline styles and no-store privacy;
no speculative CSP that breaks hydration. Expiration remains authoritative.
Document deliberate bounded retention with a production opt-in maintenance CLI,
never silently delete development or production data during tests. Fix reproduced
Important/Critical audit findings with regression tests. No new infrastructure or
live paid provider requirements. Finish README, release checklist and progress.

## Acceptance
Lint/strict types/all native+DOM+unit tests/build and complete desktop/mobile real
PostgreSQL browser journey pass per phase. Include repeat-plan analytics, preview
privacy, 320px targets, loading/retry and share failure/cancellation. Audit0 or
explicit material issue; inspect screenshots and staged secrets/artifacts. Phase7
must truthfully distinguish locally verified release preparation from unverified
external OpenAI, hosted database, real-device Web Share and remote CI/deployment.
