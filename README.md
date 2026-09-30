# Veya

**Less planning. More living.** Veya is an intent network: start with what you
want to do, bring your friends, and find what works for the group.

The MVP's priority is the viral loop:

> Create intent → share invite → friend joins without an account → add availability
> and preferences → find the best overlap → get a group result → create another intent.

## Current scope

**Phases 1–2 — foundation and persistent backend.** The Next.js shell and landing
work without credentials. PostgreSQL migrations, guest sessions, authorized data
access and JSON APIs now support persistent intents and participation without
accounts. The landing still shows an explicit local draft preview; connecting it
to these APIs and building `/i/[public_slug]` are Phase 3.

The landing draft is lost on refresh. Backend guest identity persists in an
HttpOnly cookie for 30 days. Scheduling/voting UI and AI enhancements come later.
Read [CODEX_PROGRESS.md](CODEX_PROGRESS.md) before starting work.

## Local setup

Use **Node.js 24 LTS** (or Node.js 22.12+) and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The example environment works
as-is. Next.js reads `.env.local`; never commit that file.

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

Run `npm run build` before `npm run test:e2e`. Playwright starts `next start` on
port 3100 and stops it afterward. It uses `/usr/bin/chromium` if present;
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
| `DATABASE_URL` | Unset | Server-only PostgreSQL URI; required by HTTP APIs, optional for the landing |
| `AI_PROVIDER` | `mock` | Phase 1 supports `mock` only |
| `OPENAI_API_KEY` | Unset | Reserved server-only key; remote provider arrives in Phase 5 |
| `ANALYTICS_ENABLED` | `false` | Opt into safe PostgreSQL events for intent creation and joins |
| `NODE_ENV` | Managed by Next.js | `development`, `test` or `production` |

Never prefix secrets with `NEXT_PUBLIC_`. No intent text or display names are sent
to analytics. The app needs no remote fonts, assets, AI calls or analytics requests.

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
  app/                    Pages, styles, metadata, error/404 UI
  components/             Shared brand, icons and decorative artwork
  features/
    intents/              Draft validation, examples, interactive composer
    backend/              Validated services, guest authorization, safe views, HTTP
    scheduling/           Domain-only engine contract for Phase 4
  lib/
    config/               Pure env parser and server-only accessor
    db/                   Typed SQL, transactions, migrations, demo seed
    ai/                   Text-generation contract, mock, server factory
    analytics/            Typed contract, no-op and opt-in PostgreSQL adapter
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

The mock AI adapter validates a 1–4000 character prompt and returns trimmed text
without a network request. It is an explicit contract stub, not intent
understanding. Phase 5 adds structured tasks, validated OpenAI output, timeouts
and fallbacks. Scheduling currently has types only and must remain independent
of UI, persistence and AI when implemented in Phase 4. date-fns is installed for
that work. Analytics is disabled by default; enabled backend events store only
event names, enumerated surfaces and timestamps, never personal text or tokens.

## Backend API contract

All responses use `Cache-Control: no-store`. Mutations require an Origin header
matching `NEXT_PUBLIC_APP_URL`. POST/PUT bodies must be application/json and at
most 16 KiB. Send cookies with requests; no user/guest/participant IDs are accepted
from clients. Browser guest cookies are HttpOnly, SameSite=Lax, scoped to `/`,
and Secure when NODE_ENV=production. Use HTTPS outside localhost.

| Method and path | Behavior |
| --- | --- |
| `POST /api/session` with `{}` | Reuse an active cookie or create a guest; returns no token in JSON |
| `DELETE /api/session` | Revoke the current guest token and clear the cookie |
| `POST /api/intents` | Create an intent for the current guest |
| `GET /api/intents/[slug]` | Public intent/count plus the current guest's own membership |
| `DELETE /api/intents/[slug]` | Creator-only close; retains records and marks expired |
| `POST /api/intents/[slug]/participants` | Join once; 201 on creation, 200 on duplicate without replacing data |
| `PUT /api/intents/[slug]/participants/me` | Replace only the caller's existing participant data |

Create body: `rawText` (trimmed 1–500 chars), optional `title` (1–120),
`creatorName` (defaults to “A friend”), optional structured intent `{type,
activities, location}`, optional offset ISO `expiresAt` (future, within 30 days;
defaults to 7 days). Structured type: general/meet/travel/game/study. No AI parsing
occurs yet; the backend validates and persists the supplied structure.

Participant body: `displayName` (1–60), optional `availability` array of
`{startAt,endAt}` offset ISO instants, `preferences` array of `{category,value}`
(activity/dietary/location), `notes` (≤1000), and nullable `budgetMin`, `budgetMax`,
`currency`. Budgets are **integer minor units** (1000 = USD 10.00), nonnegative,
ordered, and require a supported uppercase currency. Windows must be future,
non-overlapping, ≤24 hours each, and inside the intent expiry/next 30 days.
PUT replaces all fields; omitted optional fields return to their defaults.

Public views expose no internal IDs, emails, session hashes or other people's
notes/budgets/windows/preferences. Only your own membership appears with your
valid cookie. Expired invites return status expired and reject joins/updates
(410); decided plans reject changes (409). Expired/revoked credentials cannot
write (401). Suggestions/votes are invalidated on membership changes; automatic
recomputation and voting endpoints are Phase 4.

Stable error JSON is `{error:{code,message}}`; invalid input is 400, missing
resources 404, forbidden actions/origins 403, oversized bodies 413, wrong content
type 415, and database failure 503. Driver errors and secrets are never returned.

## Production deployment

Use a Node-capable Next.js host with Node 24 LTS. Install with `npm ci`, build with
`npm run build`, then `npm start` (or `npm start -- --port 8080`). Set
`NEXT_PUBLIC_APP_URL` to the public HTTPS origin **before building**, because the
landing is statically rendered. Store future database/AI secrets in the host's
server environment. Rebuild after changing public configuration.

Apply `NODE_ENV=production npm run db:migrate` with the trusted production
DATABASE_URL before starting the backend. Supply migration files with the CLI
checkout. Do not run the demo seed in production. API routes require a live
database; the landing can still build without one. Rate limiting, retention
policies and a full release audit remain Phase 7 work.

The foundation can be deployed as a preview. It is not yet the viral MVP or a
release candidate. No deployment is performed by the development phase run.

## Roadmap

1. Foundation — complete.
2. Database and backend — complete.
3. Create + invite + join — guest entry and sharing.
4. Scheduling engine — deterministic overlap, compromises, results and votes.
5. AI layer — optional structured enhancements and fallbacks.
6. Product quality + virality — mobile polish, previews and repeat creation.
7. Hardening + release preparation — audit and release verification.

Each autonomous run completes exactly one phase, verifies it, updates
`CODEX_PROGRESS.md`, creates a clear commit and stops.
