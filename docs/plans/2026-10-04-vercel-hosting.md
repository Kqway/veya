# Vercel hosting implementation plan

Goal: run the existing Intavro Next.js application on Vercel with external PostgreSQL, without replacing identity, scheduling, matching, notifications or realtime.

1. Add a fail-closed bearer-authenticated GET cron route using the existing durable candidate and notification jobs. Keep bounded batches, cooperative deadlines, numeric operational logging and read-only controls. Never migrate or apply retention from HTTP.
2. Use Node 24, explicitly trace SQL migrations and local OG fonts, attach the query pool to Vercel's lifecycle, and give SSE a 240-second lifetime within a 300-second function budget. Preserve the shared hub and subscription caps; close its LISTEN connection after the last serverless response. Retain the existing lifecycle on persistent hosts.
3. Test authentication before database work, real PostgreSQL cron concurrency/idempotency, read-only behavior, safe errors, and listener cleanup. Verify build artifacts contain runtime files.
4. Document required settings, TLS/pooler distinctions, manual migrations, preview isolation, cron tariff limits, backups and a two-user HTTPS smoke test. Run the complete release gates and an independent review before normal commits/push.

Actual publication requires access to the owner's Vercel project and production PostgreSQL. No secrets or hosting access are presently configured. Local verification does not constitute a deployed-environment verification.
