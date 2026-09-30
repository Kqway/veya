# Veya Phase 1: foundation

## Goal and scope

Give the existing Veya repository a production-buildable, locally runnable
foundation for the intent network. The product's future viral loop is create →
share → guest join → overlap → create again. This run implements **Phase 1 only**.
The user's autonomous-run instruction supplies scope and execution authorization.

## Architecture

Use Next.js App Router, strict TypeScript, Tailwind CSS, Zod, PostgreSQL through
`pg`, and date-fns (reserved for later scheduling work). Use npm and commit its
lockfile. Keep application routes in `src/app`, reusable presentation in
`src/components`, domain code in `src/features`, and infrastructure in `src/lib`.
Server configuration and database/AI factories use `server-only` import guards.

The app must build and run with no external credentials. The database adapter
creates a bounded PostgreSQL connection pool only when explicitly requested.
Parameterized queries are the database interface; no schema, migrations or CRUD
are added in this phase. Supabase is unnecessary at this stage and may later host
the PostgreSQL database. AI exposes a text-generation interface and deterministic
mock adapter only. Analytics exposes a no-op adapter. Scheduling exports domain
interfaces only, clearly labeled as a Phase 4 extension point.

## Consumer experience

Responsive cream canvas, dark ink, a restrained coral accent, large typography,
and a central input labeled “What do you want to do?”. Example buttons: Meet
friends, Go somewhere tonight, Plan a trip, Play games, Study together. CTA:
“Make it happen”. Submitting a valid idea shows a local draft preview and clearly
states that invites are coming soon. Editing restores the input. This is not
persistent intent creation and must never imply that a share link exists.

No accounts, dashboards or settings. Include keyboard focus, accessible labels,
inline validation, reduced-motion support, error/not-found shells, local SVG
artwork, metadata and an application icon. Avoid remote fonts and asset fetches.

## Configuration and privacy

Provide `.env.example`. Default `AI_PROVIDER=mock` and analytics disabled.
`DATABASE_URL` and `OPENAI_API_KEY` are optional server-only values; OpenAI tasks
and provider integration are deferred to Phase 5. Public origin is the only
browser-safe configuration. Reject invalid URLs/settings with field names only,
without echoing credentials. Never log submitted intent text by default.

## Verification and handoff

Vitest tests pin configuration defaults/validation, deterministic mock behavior,
and real form behavior. Playwright exercises the local journey, keyboard input,
mobile layout and browser error detection using system Chromium when available.
Run lint, typecheck, tests, production build and browser smoke checks. Document
setup and limits in README and record verified progress in CODEX_PROGRESS.md.
Review changes and create `phase-1: foundation`. Phase 2 is the exact next run.
