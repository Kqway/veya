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
