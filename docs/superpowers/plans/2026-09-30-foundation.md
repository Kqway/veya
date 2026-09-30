# Veya Foundation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Complete exactly Phase 1 with a usable consumer shell and tested infrastructure boundaries.

**Architecture:** Next.js App Router with feature-local UI and server-only infrastructure. No service is contacted at startup; interfaces provide extension points for later phases.

**Tech Stack:** Next.js, React, strict TypeScript, Tailwind CSS, PostgreSQL/pg, Zod, date-fns, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-foundation-design.md`

## Global Constraints

- Phase 1 only; no persistent intent creation, guest sessions or scheduling algorithm.
- Run without external credentials, remote fonts or external assets.
- Use npm with a committed lockfile.
- CTA copy is “Make it happen”; central label is “What do you want to do?”.
- Only public origin can be exposed to the browser; configuration errors cannot echo secrets.
- Work in the supplied clean `work` checkout; create the single requested phase commit at the end.

## Review Focus

- Missing environment values: local build and landing must work.
- Invalid secret URL: validation must report only field names.
- Whitespace or oversized ideas: show accessible errors, never a success preview.
- Keyboard-only and narrow viewport: input, examples, submission and editing remain usable.
- Local draft: no false claim of persistence or a working invite link.

## Task 1: Tooling and infrastructure contracts

**Files:** `package.json`, TypeScript/Next/Tailwind/ESLint/Vitest configs, `.env.example`, `src/lib/config/*`, `src/lib/db/*`, `src/lib/ai/*`, `src/lib/analytics/*`, `src/features/scheduling/types.ts`, `tests/unit/*`.

**Interfaces:** `parseServerEnv(source): ServerEnv`; `getServerEnv(): ServerEnv`; `createDatabase(connectionString): Database`; `getDatabase(): Database`; `AiProvider.generateText(input): Promise<TextGenerationResult>`; `AnalyticsClient.track(event): Promise<void>`; scheduling types only.

- [x] Install locked dependencies and configure strict TS, ESLint, Vitest and Tailwind.
- [x] Write tests for default env, optional services, invalid origins/providers, redacted invalid secrets, deterministic mock output and empty mock prompt.
- [x] Run `npm test -- tests/unit` and observe missing behavior.
- [x] Implement configuration and server boundaries, lazy database adapter, mock AI, no-op analytics and scheduling interfaces.
- [x] Run `npm test -- tests/unit`; expect all tests pass.

## Task 2: Landing and application shell

**Files:** `src/app/*`, `src/components/*`, `src/features/intents/*`, `public/*`, `tests/ui/intent-composer.test.tsx`, `tests/e2e/landing.spec.ts`, `playwright.config.ts`.

**Interfaces:** `IntentComposer(): React.JSX.Element`; `draftIntentSchema` validates trimmed 1–500 character ideas. Consumes infrastructure only as future extension points; no calls to persistent services.

- [x] Write form tests for blank input, example selection, normalization, oversized input and restoring a draft for editing.
- [x] Run `npm test -- tests/ui`; observe missing form behavior.
- [x] Build responsive shell, landing, local draft preview, validation, error/404 UI and local assets.
- [x] Run `npm test`; expect full unit/UI suite pass.
- [x] Write browser checks for default landing, real submit/edit, keyboard behavior, mobile overflow and 404 navigation.
- [x] Build and run browser checks against `next start`; expect no browser errors and no horizontal overflow.

## Task 3: Verification and persistent progress

**Files:** `README.md`, `CODEX_PROGRESS.md`, `.github/workflows/ci.yml`.

**Interfaces:** scripts `lint`, `typecheck`, `test`, `test:e2e`, `build`, `dev`, `start` form the developer workflow.

- [x] Document local setup, architecture, environment variables, commands and honest phase limits; add CI.
- [x] Run lint, typecheck, all unit/UI tests, production build and browser checks.
- [x] Review the whole diff and dependency audit; fix material issues within Phase 1.
- [x] Record evidence and exact Phase 2 handoff in CODEX_PROGRESS.md.
- [x] Review staged files for secrets/debug output, commit `phase-1: foundation`, verify clean status, stop.
