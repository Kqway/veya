# Vercel hosting privacy/security review

Scope: hosting adaptation against baseline `38c9f8d7a842ee35bc1d5f90da937ae12861ea76`;
existing social domain, privacy projections, applied SQL and scheduling engine remain
unchanged. This review covers source and isolated tests, not a live Vercel/Neon service.

Independent read-only review examined Cron authentication before database access,
GET machine-only authorization, query/work bounds, cooperative deadline and durable
lease recovery, TLS validation, serverless pool/lifecycle cleanup, subscription caps,
runtime SQL/font packaging, Docker compatibility and test credential isolation.

One Important finding was reproduced: an initial request-owned EventHub bypassed
the existing three-stream-per-profile cap and opened four native LISTEN sessions for
four concurrent requests. The fix shares a hub per Vercel instance and counts active
responses, including pending authorization. Next `after` releases each response; the
last callback detaches the holder synchronously before asynchronously closing it.
Other active streams retain the listener; new requests get a fresh hub. Idempotent
callbacks and captured holders cannot close a newer generation.

Native PostgreSQL regressions verify fourth-stream rejection, one listener shared by
two users, survival after the first response ends, final listener cleanup, fresh
reconnection, no listener for unauthorized requests, and cleanup during another
request's pending authorization. Independent re-review and six relevant tests passed;
no remaining confirmed Important/Critical finding was identified.

Cron tests cover missing/wrong credentials and guest cookies, no-store errors,
unconfigured fail-closed behavior, no client-supplied batch overrides, read-only skip
before DB, concurrent real durable jobs/deduplication, no automatic Interested, safe
numeric results and redacted driver/config failures. The endpoint neither migrates
nor deletes retention data. Test environment strips inherited Cron/hosting credentials.

Production requirements still include verified HTTPS/TLS, Neon pooled/direct URLs for
the same production database, credential separation for previews, a frequent scheduler,
Vercel function/connection budgets, moderation ownership and backup/restore checks.
The existing per-profile hub cap is per instance; shared rate limits and infrastructure
connection budgets remain necessary across instances. Host hard-timeout recovery
uses existing durable leases. No claim of a deployed-environment audit is made.

## Managed Neon configuration follow-up, 2026-10-04

Reviewed the server-only configuration diff after the owner connected the Neon
Marketplace resource. Provider secrets were found targeted at preview and production;
all current provider environment-variable targets were restricted to production.
The integration's connection metadata still needs to remain production-only during
future owner changes or provider secret synchronization; no production credentials
were present in prior preview deployments. Automatic preview deployments are now
disabled until an isolated synthetic preview database is configured.

On Vercel only, absent `REALTIME_DATABASE_URL` now uses the provider's
`DATABASE_URL_UNPOOLED`; explicit configuration takes precedence. The fallback goes
through the same validation and secret-safe errors and is not a new returned field.
With explicit `DATABASE_SSL_MODE=verify-full`, only a single `sslmode=require` on a
`.neon.tech` hostname is upgraded to `verify-full`. Query and LISTEN drivers continue
to strip URL TLS overrides and enforce certificate/hostname verification. Disable,
no-verify, conflicting modes, other providers and Neon realtime pooler hosts remain
rejected. No identity, authorization, DTO, public metadata or migration changes.

Regression tests first reproduced missing direct fallback, require-mode rejection,
malformed fallback error handling and inherited E2E provider credentials. Eleven new
configuration cases and the strengthened test-isolation case pass. The existing
driver regression still proves explicit verified TLS defeats URL transport overrides.
Read-only source review found no remaining confirmed Important/Critical finding in
this follow-up. This does not claim the hosted two-user/reconnect/device journey.

The initial SQL Editor artifact used multiple top-level commands, which Vercel's
prepared-query transport rejected before any write. A single atomic `DO` artifact
preserves all 18 migration bytes/checksums and the advisory lock. Native PostgreSQL
extended-protocol checks reproduce the original error and verify atomic rollback,
concurrent/repeat execution, checksum rejection and compatibility with the CLI ledger.
Owner reports execution complete; hosted readiness must independently verify history.
