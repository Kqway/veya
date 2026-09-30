# Veya

**Less planning. More living.** Veya is an intent network: start with what you
want to do, bring your friends, and find what works for the group.

The MVP's priority is the viral loop:

> Create intent → share invite → friend joins without an account → add availability
> and preferences → find the best overlap → get a group result → create another intent.

## Current scope

**Phases 1–6 — guest planning, optional AI and a mobile-first sharing loop.** Turn an
idea into a plan, share `/i/<slug>`, and let friends add availability, preferences
and budgets without an account. Copy link, Telegram and native sharing are supported.
Returning guests can refresh and edit their own details with the same browser.
Open `/i/<slug>/results` for the best time and alternatives, vote YES/MAYBE/NO,
and let the organizer explicitly confirm the group plan. Help with details previews
editable intent suggestions; Get a meetup idea adds an optional idea and grounded
explanation. Both work locally without an AI key.

PostgreSQL is required to create or load plans; the landing and build work without
credentials. Start the local database and apply migrations using the workflow below.
Read
[CODEX_PROGRESS.md](CODEX_PROGRESS.md) before starting work.

## Local setup

Use **Node.js 24 LTS** (or Node.js 22.12+) and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The example environment opens
the landing; persistent plan creation needs DATABASE_URL and migrations (see below).
Next.js reads `.env.local`; never commit that file.

To run the production build locally:

```bash
npm run build
npm start
```

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run lint` | Next.js/TypeScript ESLint rules, zero warnings |
| `npm run typecheck` | Generate route types and run strict TypeScript |
| `npm test` | All unit, DOM and native PostgreSQL integration tests |
| `npm run test:watch` | Watch all unit/DOM/integration tests |
| `npm run test:integration` | Native PostgreSQL backend/HTTP/schema/seed tests |
| `npm run db:local` | Persistent local PostgreSQL on 127.0.0.1:54322 |
| `npm run db:migrate` | Apply checked SQL migrations atomically |
| `npm run db:seed` | Apply migrations and create an idempotent demo |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run test:e2e` | Desktop/mobile Chromium checks against the production server |
| `npm run check` | Lint, types, all unit/DOM/integration tests, production build |

Run `npm run build` before `npm run test:e2e`. Playwright starts an isolated native PostgreSQL cluster, applies migrations and
serves `next start` on port 3100 with a matching origin. It stops both afterward.
It never uses DATABASE_URL or an already-running development server. It uses `/usr/bin/chromium` if present;
otherwise install its browser once:

```bash
npx playwright install chromium
npm run build
npm run test:e2e
```

Linux CI may need `npx playwright install --with-deps chromium`.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects another installed Chromium binary.
CI runs lint, types, all unit/DOM/native PostgreSQL integration tests, build and
both browser projects. Native PostgreSQL tests require a non-root worker.

## Environment configuration

`src/lib/config/env.ts` validates configuration with Zod; the server accessor is
guarded by `server-only`. Errors name invalid fields and omit their values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Public HTTP(S) origin for metadata; no paths, query, credentials or fragments |
| `DATABASE_URL` | Unset | Server-only PostgreSQL URI; required by persistent plan APIs |
| `AI_PROVIDER` | `mock` | `mock` for local templates or `openai` for optional remote assistance |
| `OPENAI_API_KEY` | Unset | Server-only secret; a missing key uses local fallback |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Optional remote model identifier |
| `ANALYTICS_ENABLED` | `false` | Opt into nine bounded entry/result event names in PostgreSQL |
| `NODE_ENV` | Managed by Next.js | `development`, `test` or `production` |

Never prefix secrets with `NEXT_PUBLIC_`. No intent text or display names are sent
to analytics. The app needs no remote fonts, assets or AI calls. Disabled analytics sends no
tracking requests. Pages render on demand to read the runtime analytics flag.

## Database boundary

`getDatabase()` in `src/lib/db/index.ts` creates a lazy, bounded `pg` pool on first
use. `createDatabase(connectionString)` supports explicitly managed adapter
lifetimes; call `close()` when done. `query<Row>(text, values)` returns typed rows
and a row count. Always bind user values as parameters:

```ts
const result = await getDatabase().query<{ value: string }>(
  "select $1::text as value",
  ["example"],
);
```

For local database development, install PostgreSQL 16+ and create a database and
role, or use an existing instance. Set a connection URI such as:

```dotenv
DATABASE_URL=postgresql://veya:your-local-password@localhost:5432/veya
```

A Supabase PostgreSQL URI can use the same adapter. Follow the provider's TLS
configuration; keep certificate verification enabled. Use a trusted server
connection that owns the tables or has BYPASSRLS. Migrations enable row-level
security with no direct-client policies; even provider-granted anon/authenticated
table privileges cannot expose session hashes or private participant data.
Guest authorization is enforced by the server service. Never expose this URI or
add permissive client policies to bypass the service.

Transactions pin one pg connection and roll back all writes on failure.
`db/migrations/*.sql` are applied under an advisory transaction lock; checksums
are recorded in `veya_schema_migrations`. Do not edit applied migration files.
Add a new numbered migration for changes. Repeated migration commands are safe.

### Local database without an external account

The `embedded-postgres` dev dependency ships native PostgreSQL binaries. Run as
a non-root user on a supported platform; install scripts and optional platform
dependencies must be enabled. Production uses normal PostgreSQL via `pg`.

In terminal 1:

```bash
npm run db:local
```

Set this **local-development-only** URI in `.env.local`:

```dotenv
DATABASE_URL=postgresql://veya:veya-local-only@127.0.0.1:54322/veya
```

In terminal 2:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

The cluster binds to loopback, uses SCRAM authentication and persists under
git-ignored `.local/postgres`. Stop with Ctrl+C; start it again to reuse the data.
The migration/seed CLI defaults to this localhost URI when DATABASE_URL is unset
in development. The application never defaults to a database connection.

The seed prints `/api/intents/<slug>` and creates four demo friends, availability,
preferences, two suggestions, votes and one safe analytics event. Repeating it
does not duplicate or reset data. Demo guest bearer tokens are not recoverable;
open the public endpoint or create your own session to join. The demo expires
after 30 days and an existing seed is not refreshed. Seeding is blocked when
NODE_ENV=production; production migrations require an explicit DATABASE_URL.

`npm test` starts isolated ephemeral native PostgreSQL clusters and cleans them
up; it never uses or resets DATABASE_URL or your development/production database.

## Architecture

```text
src/
  app/                    Pages, invite route, styles, metadata, error/404 UI
  components/             Shared brand, icons and decorative artwork
  features/
    intents/              Draft validation, shared structured schema, interactive composer
    backend/              Validated services, guest authorization, safe views, HTTP
    entry/                Guest browser API, money/time helpers, invite/share/forms
    scheduling/           Pure overlap/ranking engine and focused results/voting UI
  lib/
    config/               Pure env parser and server-only accessor
    db/                   Typed SQL, transactions, migrations, demo seed
    ai/                   Structured tasks, mock/OpenAI providers, validation and fallback
    analytics/            Typed contract, opt-in browser events and PostgreSQL adapter
db/migrations/            Versioned domain schema and server-only RLS boundaries
scripts/                  Local PostgreSQL and migration/seed CLI
tests/
  unit/                   Environment and mock-provider behavior
  ui/                     Actual form interaction tests
  e2e/                    Production-browser desktop/mobile checks
  integration/            Native PostgreSQL transactions, services, HTTP and seed
  support/                Test-only setup and server-only alias
docs/superpowers/          Phase design and implementation record
```

AI tasks parse intent details, suggest a meetup idea and explain existing proposals.
The mock uses a small explicit English/Russian vocabulary and templates; it is not
a language model. OpenAI output is validated and failures use local fallback.
Scheduling runs without AI: its pure `suggest` function takes
explicit bounds, duration and participant data and returns deterministic proposals.
Analytics is disabled by default; enabled events store only
event names, enumerated surfaces and timestamps, never personal text or tokens.

## Create, invite and join

1. Enter an idea on the landing. Add your name, collect replies for 3/7/14 days,
   and optionally choose a type, activities and a place. Help with details previews
   suggestions; Apply details explicitly copies them into editable fields.
   Manual creation remains available during assistance or after failure.
   Create invite opens the saved plan.
2. Copy its link, send it through Telegram, or use native sharing if available.
   Clipboard failure leaves a selectable URL for manual copying.
3. Friends open the link and select Add yourself. The creator can also add their
   own availability. Choose at least one future time in the next seven local days:
   Morning 09–12, Afternoon 12–17, Evening 17–22, or custom times.
4. Optionally enter a budget/currency, comma-separated activity/food/location
   preferences and a note. Times are shown in the browser's named timezone and
   saved as UTC instants; nonexistent local DST times and overlapping ranges fail.
5. Refresh the same browser to see saved details and edit them. Only your own
   private fields are visible on the invite. Group members and the organizer see
   names and derived attendance on results. New availability choices cover seven days; valid
   previously saved windows beyond that horizon are preserved when editing.

A cookie identifies this browser for 30 days; clearing/revoking it loses access
as that guest. Revoked edits explain the expired session instead of creating a new
identity. Invalid/expired/decided invites have explicit states. Invite/result pages request no-store JSON
and remain noindex. Open Graph/Twitter previews use only the public organizer name
and fixed invitation copy; participant data, intent text and hints stay out of previews.

With ANALYTICS_ENABLED=true, backend mutations record intent_created and
participant_joined once, and vote_submitted on a new or changed vote. The browser
sends landing_view, intent_started, invite_opened, invite_link_copied and
result_viewed through bounded same-origin `/api/analytics`. Create your own plan
links track new_intent_from_invite with only invite/result surface. Analytics uses
keepalive for navigation, stays silent when disabled and never delays the next plan.
That endpoint accepts only fixed event/surface pairs and rejects extra fields.
Analytics failures do not block the guest UI. Production rate limiting is Phase 7.

## Find a time and decide

The service seeks 60-minute meetups before the invite expires, within 30 days.
The engine merges adjacent/overlapping windows and evaluates event boundaries,
30-minute UTC starts and shorter spans across boundaries. Spans normally reach
at least 15 minutes; if none can, even a shorter real window is offered. Full attendance ranks first, then
availability quality, shared activity/food/location preferences, compatible budgets
and deterministic time ordering. Budgets use integer minor units; different
currencies are never compared or converted. Preference similarity does not assert
dietary safety or venue suitability.

Results contain a best match and up to three non-overlapping alternatives; fewer
appear when availability is limited. If nobody shares a full hour, a shorter
meetup or the largest available subgroup provides a compromise. Partial attendees
are listed separately. Empty/past availability prompts friends to add future times.
Times display in the current browser timezone, including the end date overnight.

Suggestions are generated and stored on the first results read. Repeated reads
preserve proposal keys and votes when inputs and outputs are unchanged. Participant
changes or elapsed options regenerate the set and clear old votes. Old submissions
return `STALE_RESULTS` (409); Reload results fetches the current proposals. Reads,
recomputation, votes and confirmation serialize under the intent's transaction lock.

Only a current member can vote; each can change one vote per proposal. The organizer
chooses a proposal, then confirms in a separate step. A decided plan freezes its
saved result and closes joining, editing and voting. Repeating the same confirmation
is idempotent. The collection deadline or a creator close cannot erase a confirmed
selection. Refresh results retrieves other people's latest votes or decision.

Anonymous visitors see aggregate availability and votes. Active members and the
organizer additionally see names with Available/Partly available/Unavailable for
each proposal. Other people's raw windows, preferences, budgets and notes remain
private. Suggested activity labels come only from the public intent, while private
preferences affect ranking. Aggregate budget compatibility may appear in the
group proposal; numerical budget ranges never appear.

## Mobile flow and share previews

Creation keeps the current idea prominent and compacts the landing header. Join
forms focus the display name, available times show selection feedback, and all
controls remain usable at 320px. Loading and subtle transitions respect reduced
motion. Create your own plan follows joining/results and returns directly to the
landing, closing the create → share → join → result → create loop.

Copy link handles permission failure with a selectable URL; native sharing guards
duplicate clicks, reports success and keeps cancellation quiet. Telegram/native
copy includes only the public organizer and fixed invitation text. Link previews
read only organizer name and effective status; closed/unknown/unavailable plans
have generic copy. Images render locally from the bundled font. Unicode names are
preserved in metadata; names requiring extra fonts/emoji use generic image copy,
so no external asset request is needed. Images and API data use no-store. Social
platforms may still retain their own cached preview; public names are already part
of invite visibility. Configure the public HTTPS origin before starting the host.

## Optional AI assistance

The default `AI_PROVIDER=mock` needs no credentials or network. It recognizes a
small English/Russian activity vocabulary, today/tomorrow/day after tomorrow,
explicit ISO dates, this calendar week (today through Sunday), and literal place
and budget hints. Unknown details stay empty. Relative dates use the browser's
explicit local reference date; arithmetic beyond supported ISO dates stays unknown.

For remote assistance set `AI_PROVIDER=openai` and `OPENAI_API_KEY` in the server
environment, optionally choose `OPENAI_MODEL`, and restart. The host needs access
to `api.openai.com` and a model supporting strict JSON-schema output. Never use a
`NEXT_PUBLIC_` key. Parsing sends only the idea, reference date and IANA timezone.
Apply details explicitly publishes reviewed details with the intent. Date and
budget hints are advisory text, separate from expiry, participant budgets and
scheduling constraints; they can be removed before creating the invite.

Only the active organizer or a current member can request proposal assistance.
The server sends public intent text/activities/place and aggregate proposal facts,
never participant names, windows, notes, preferences, numerical budgets, IDs or
votes. Ideas render as plain text in a separate panel. Factual explanations come
from validated reason codes and server-owned phrases grounded in the proposal.
Assistance does not change proposals, attendance, votes or confirmation. It is
transient; refreshing clears it while saved votes remain.

Calls happen only after explicit clicks. The remote transport uses the fixed
OpenAI chat-completions endpoint, strict JSON schemas, 1000 output tokens,
`store=false`, a 64 KiB response limit and an overall eight-second deadline.
There are no retries or redirects. Parallel idea/explanation calls run outside
transactions; access and proposal revision are checked again before returning.
Missing keys, network/HTTP errors, refusals, malformed/truncated output and timeouts
use local fallback. Invalid user input is rejected. The core planning flow does
not wait for assistance; raw provider errors or prompts are not logged.

Tests inject the remote transport and force mock/no key in browser tests. Live
OpenAI access was not verified in this environment, which has no configured key
or allowed OpenAI egress. Production rate/cost/load controls remain Phase 7 work.

## Backend API contract

All responses use `Cache-Control: no-store`. POST/PUT/DELETE require an Origin header
matching `NEXT_PUBLIC_APP_URL`. POST/PUT bodies must be application/json and at
most 16 KiB. Send cookies with requests; no user/guest/participant IDs are accepted
from clients. Browser guest cookies are HttpOnly, SameSite=Lax, scoped to `/`,
and Secure when NODE_ENV=production. Use HTTPS outside localhost.

| Method and path | Behavior |
| --- | --- |
| `POST /api/analytics` | Optional bounded browser event; no personal properties |
| `POST /api/session` with `{}` | Reuse an active cookie or create a guest; returns no token in JSON |
| `DELETE /api/session` | Revoke the current guest token and clear the cookie |
| `POST /api/ai/intent` | Optional stateless parsing; no database or guest session required |
| `POST /api/intents/[slug]/assist` | Optional proposal assistance for an active organizer/member |
| `POST /api/intents` | Create an intent for the current guest |
| `GET /api/intents/[slug]` | Public intent/count plus the current guest's own membership |
| `DELETE /api/intents/[slug]` | Creator-only close; retains records, marks active plans expired and preserves decisions |
| `POST /api/intents/[slug]/participants` | Join once; 201 on creation, 200 on duplicate without replacing data |
| `PUT /api/intents/[slug]/participants/me` | Replace only the caller's existing participant data |
| `GET /api/intents/[slug]/results` | Generate/read saved proposals and safe group/own vote projection |
| `POST /api/intents/[slug]/votes` | Member-only upsert of YES/MAYBE/NO on a current proposal |
| `POST /api/intents/[slug]/decision` | Creator-only explicit confirmation of a current proposal |

Create body: `rawText` (trimmed 1–500 chars), optional `title` (1–120),
`creatorName` (defaults to “A friend”), optional structured intent `{type,
activities, location, dateHint?, budgetHint?}`, optional offset ISO `expiresAt` (future, within 30 days;
defaults to 7 days). Structured type: general/meet/travel/game/study. Date hints
are nullable `{startDate,endDate,text}` with ordered real ISO dates and text ≤80;
budget hints are nullable text ≤80. Existing bodies without hints remain valid.
Creation only validates and persists supplied details; it does not invoke AI.

Parse body: `{text,referenceDate,timeZone}`; idea is 1–500 characters, referenceDate
is a real `YYYY-MM-DD` and timezone is a valid IANA zone. Returns `{data,source}`
with strict parsed fields and source `mock`/`openai`/`fallback`. Assist body:
`{suggestionKey,revision}`. Returns those keys plus typed `idea` and `explanation`
results. Missing/revoked sessions return 401, outsiders 403, stale selections 409;
a session or revision change during generation is rejected too.

Participant body: `displayName` (1–60), optional `availability` array of
`{startAt,endAt}` offset ISO instants, `preferences` array of `{category,value}`
(activity/dietary/location), `notes` (≤1000), and nullable `budgetMin`, `budgetMax`,
`currency`. Budgets are **integer minor units** (1000 = USD 10.00), nonnegative,
ordered, and require a supported uppercase currency. Windows must be future,
non-overlapping, ≤24 hours each, and inside the intent expiry/next 30 days.
PUT replaces all fields; omitted optional fields return to their defaults.

Vote body: `{suggestionKey,revision,value}`; decision body: `{suggestionKey,revision}`.
`suggestionKey` is an opaque 32-character hexadecimal public key, separate from
internal UUIDs; `revision` is the integer returned by results; `value` is
`yes`/`maybe`/`no`. Extra identity fields are rejected. Results include aggregate
counts, own vote and (for creator/members only) derived named attendance.

Public views expose no internal IDs, emails, session hashes or other people's
notes/budgets/windows/preferences. Only your own membership appears with your
valid cookie. Expired invites return status expired and reject joins/updates/votes
(410); decided plans reject changes (409). Expired/revoked credentials cannot
write (401). Suggestions/votes are invalidated on membership changes; result reads
recompute active plans. Expired and decided plans retain their saved proposals.

Stable error JSON is `{error:{code,message}}`; invalid input is 400, missing
resources 404, forbidden actions/origins 403, oversized bodies 413, wrong content
type 415, and database failure 503. Driver errors and secrets are never returned.

## Production deployment

Use a Node-capable Next.js host with Node 24 LTS. Install with `npm ci`, build with
`npm run build`, then `npm start` (or `npm start -- --port 8080`). Set
`NEXT_PUBLIC_APP_URL` to the public HTTPS origin in the server environment before
starting. Pages render on demand and read runtime metadata/analytics configuration.
Restart the server after changing its origin or analytics flag. Keep database/AI
secrets in the host's server environment.

Apply `NODE_ENV=production npm run db:migrate` with the trusted production
DATABASE_URL before starting the backend. Supply migration files with the CLI
checkout. Do not run the demo seed in production. Persistent plan APIs require a live
database; the landing and stateless intent parser work without one. Rate limiting, retention
policies and a full release audit remain Phase 7 work.

The current application can be deployed as a preview. It is not yet the viral MVP or a
release candidate. No deployment is performed by the development phase run.

## Roadmap

1. Foundation — complete.
2. Database and backend — complete.
3. Create + invite + join — complete.
4. Scheduling engine — complete: deterministic overlap, compromises, results, votes and confirmation.
5. AI layer — complete: reviewed structured parsing, optional ideas/explanations and bounded provider fallback.
6. Product quality + virality — complete: compact mobile creation, responsive availability feedback, resilient sharing, public-only previews and tracked repeat creation.
7. Hardening + release preparation — audit and release verification.

Each autonomous run completes exactly one phase, verifies it, updates
`CODEX_PROGRESS.md`, creates a clear commit and stops.
