# Veya

**Less planning. More living.** Veya is an intent network: start with what you
want to do, bring your friends, and find what works for the group.

The MVP's priority is the viral loop:

> Create intent → share invite → friend joins without an account → add availability
> and preferences → find the best overlap → get a group result → create another intent.

## Current scope

**Phase 1 — foundation.** A responsive landing page, example ideas, validated local
draft preview, accessible application shell and infrastructure interfaces.
Drafts live in React state for the current visit and are lost on refresh. The
preview explicitly says invites are coming soon.

Persistent intents, invite links, guest joining, scheduling, voting and real AI
enhancements are later phases. No account, database or AI key is needed to try
the app. Read [CODEX_PROGRESS.md](CODEX_PROGRESS.md) before starting work.

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
| `npm test` | Unit and DOM interaction tests |
| `npm run test:watch` | Watch unit/DOM tests |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run test:e2e` | Desktop/mobile Chromium checks against the production server |
| `npm run check` | Lint, types, unit/DOM tests, production build |

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
CI runs lint, types, unit/DOM tests, build and both browser projects.

## Environment configuration

`src/lib/config/env.ts` validates configuration with Zod; the server accessor is
guarded by `server-only`. Errors name invalid fields and omit their values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Public HTTP(S) origin for metadata; no paths, query, credentials or fragments |
| `DATABASE_URL` | Unset | Server-only PostgreSQL URI; unused by the current landing flow |
| `AI_PROVIDER` | `mock` | Phase 1 supports `mock` only |
| `OPENAI_API_KEY` | Unset | Reserved server-only key; remote provider arrives in Phase 5 |
| `ANALYTICS_ENABLED` | `false` | Reserved switch; Phase 1 always uses a no-op |
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
configuration; keep certificate verification enabled. A live database query is
not covered by Phase 1 tests. **Schema, migrations, seed data and backend
integration tests arrive in Phase 2**; no migration or seed commands exist yet.

## Architecture

```text
src/
  app/                    Pages, styles, metadata, error/404 UI
  components/             Shared brand, icons and decorative artwork
  features/
    intents/              Draft validation, examples, interactive composer
    scheduling/           Domain-only engine contract for Phase 4
  lib/
    config/               Pure env parser and server-only accessor
    db/                   Typed SQL interface and lazy PostgreSQL adapter
    ai/                   Text-generation contract, mock, server factory
    analytics/            Typed event contract and no-op client
tests/
  unit/                   Environment and mock-provider behavior
  ui/                     Actual form interaction tests
  e2e/                    Production-browser desktop/mobile checks
  support/                Test-only setup and server-only alias
docs/superpowers/          Phase design and implementation record
```

The mock AI adapter validates a 1–4000 character prompt and returns trimmed text
without a network request. It is an explicit contract stub, not intent
understanding. Phase 5 adds structured tasks, validated OpenAI output, timeouts
and fallbacks. Scheduling currently has types only and must remain independent
of UI, persistence and AI when implemented in Phase 4. date-fns is installed for
that work. Analytics event names match the roadmap; events are not collected yet.

## Production deployment

Use a Node-capable Next.js host with Node 24 LTS. Install with `npm ci`, build with
`npm run build`, then `npm start` (or `npm start -- --port 8080`). Set
`NEXT_PUBLIC_APP_URL` to the public HTTPS origin **before building**, because the
landing is statically rendered. Store future database/AI secrets in the host's
server environment. Rebuild after changing public configuration.

The foundation can be deployed as a preview. It is not yet the viral MVP or a
release candidate. No deployment is performed by the development phase run.

## Roadmap

1. Foundation — current phase.
2. Database and backend — models, validation, guest sessions and authorization.
3. Create + invite + join — guest entry and sharing.
4. Scheduling engine — deterministic overlap, compromises, results and votes.
5. AI layer — optional structured enhancements and fallbacks.
6. Product quality + virality — mobile polish, previews and repeat creation.
7. Hardening + release preparation — audit and release verification.

Each autonomous run completes exactly one phase, verifies it, updates
`CODEX_PROGRESS.md`, creates a clear commit and stops.
