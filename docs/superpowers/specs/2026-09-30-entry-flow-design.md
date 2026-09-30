# Veya Phase 3: intent and invite flow

## Purpose and scope
Finish one phase: a person turns an idea into a persistent plan, shares `/i/<slug>`,
and friends participate without accounts. Preserve the paper/terracotta visual
identity, English product copy and mobile-first accessible controls. Phase 4
scheduling/voting and Phase 5 AI remain excluded. User explicitly authorized
publishing to GitHub and continuing autonomously; no design approval pause.

## Architecture and choices
Use the existing JSON APIs through a small typed browser client. Keep identity in
HttpOnly cookies and backend authorization; no client-supplied internal IDs.
A second composer step requests creator display name, invite lifetime (3/7/14 days),
optional activity tags and place. Successful creation navigates to the persistent
invite. Do not require budgets before a plan exists; collect them per participant.
A client invite screen loads the private/no-store API with cookies. It owns loading,
retry, invalid/expired/decided and returning-participant states. This avoids duplicating
service logic in pages and preserves privacy without server rendering cookie data.
Compared with a separate creation page, inline details reduce navigation; compared
with new server actions, existing APIs minimize duplicate interfaces.

## Participation and time
Invite headline names the creator and displays the full intent, activity/place and
participant count. New friends choose Add yourself; creators can add availability.
A joined guest sees confirmation, their own details and an Edit your details action.
Form collects display name, at least one future availability window, optional maximum
budget/currency, activity/dietary/location preferences and a note. Existing minimum
budgets and preferences from the API must survive editing. Budgets use string decimal
conversion with Intl currency fraction digits to integer minor units, never floating
point multiplication. Unsupported/excess-precision/negative/reversed budgets fail.

Picker shows today plus six local calendar days. Quick ranges are Morning 09–12,
Afternoon 12–17 and Evening 17–22. Only ranges starting in the future and ending
before expiry are enabled; custom local start/end dates allow finer windows within
those seven days. Convert local time to UTC ISO, reject DST nonexistent times,
reversed, overlapping, past and >24h windows; adjacent windows are allowed.
Existing valid windows beyond the picker horizon are preserved on edit.
Display an explicit local timezone label. Selection is stateful and keyboard operable.

## Sharing and errors
Share actual origin plus the canonical slug path: Copy link, URL-encoded Telegram
share and Web Share when supported. Clipboard failure exposes a selectable manual
link; cancelled native share is quiet. Disabled duplicate submits plus backend
idempotent membership handle repeated joins. Inputs survive failures. A revoked
editing session never silently creates a replacement identity. API 401 prompts reload;
410/409 show closed status; 503/network errors support retry. Expired/decided plans
show their description/count without an enabled join form. Invalid invites show a
useful return-to-home action. Form errors focus an alert or offending field.

## Analytics and privacy
Backend already records intent_created and participant_joined exactly once when
ANALYTICS_ENABLED=true. Add opt-in bounded same-origin POST /api/analytics for only
landing_view, intent_started, invite_opened and invite_link_copied with fixed surfaces.
No personal fields, identifiers or arbitrary properties accepted. Default no-op never
needs a DB; analytics failures cannot block creation/join/sharing. Client fire-and-forget
tracking sends only these events; avoid duplicate StrictMode effect calls.

## Verification
Unit tests prove money/time conversion including DST, overlap and bounds; real DOM
tests prove form validation, retry/preserved inputs, sharing fallback and guest client
flows. Native PostgreSQL tests verify analytics opt-in/privacy. Playwright starts an
isolated native DB, applies migrations and runs production Next with matching origin;
never use a developer/production DATABASE_URL. Desktop/mobile tests create, share,
join from separate browser contexts, refresh/edit, submit duplicates, reject revoked
sessions and handle invalid/expired links. Check overflow and browser errors.
All existing backend tests, lint, strict types, build, audit and independent review
must pass. One final commit `phase-3: intent and invite flow`, fast-forward push to
main (already contains Phase 2), update progress and stop.
