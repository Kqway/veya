# Running a Veya release

This release targets Node 24 and PostgreSQL. Deployment remains an operator action;
no production service or database is provisioned by the repository. Use a non-root
account for both the web container and native PostgreSQL test runner.

## Build and runtime configuration

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:e2e -- --project=desktop --project=mobile
docker build --target runner -t veya:release .
docker build --target operations -t veya:operations .
bash scripts/docker-smoke.sh veya:release veya:operations
```

In a managed environment whose HTTPS proxy uses a private root, add
`--secret id=proxy_ca,src="$CODEX_PROXY_CERT"` to `docker build`. The optional
BuildKit CA mount exists only during dependency installation and never enters
image layers; TLS verification remains enabled.

The final image uses Next standalone output and the non-root `node` account. Secrets
are excluded by `.dockerignore`. Never pass secrets as Docker build arguments,
copy a runtime secret file into the build context, or bake production credentials
into `NEXT_PUBLIC_*`. The public URL is an origin, without path/query/credentials.
Production remote origins require HTTPS; loopback HTTP permits isolated local tests.
No database or AI secret is required at build time. Supply configuration at runtime
through your host's secret manager or an operator-owned environment file outside the
checkout/build context:

```sh
docker run --rm --init --name veya-web --env-file /secure/veya-runtime.env \
  -p 127.0.0.1:3000:3000 --stop-timeout 15 veya:release
```

Set `NEXT_PUBLIC_APP_URL=https://veya.example`, `DATABASE_URL`, and a suitably sized
`DB_POOL_MAX` (integer 1–20, default 5). A web instance needs at most its query pool
plus one dedicated LISTEN connection. Add worker pools and migration jobs to the
provider's connection budget before increasing replicas.

Remote production PostgreSQL defaults to verified TLS even when URL flags are absent.
You can explicitly set `DATABASE_SSL_MODE=verify-full`; insecure or conflicting URL
TLS switches are rejected. Certificate hostname and chain verification stay
on. For private provider roots, mount a trusted CA file read-only and set
`NODE_EXTRA_CA_CERTS=/run/certs/provider-ca.pem`; never use `rejectUnauthorized=false`
or insecure `sslmode` values. Explicit verified mode ignores URL TLS switches;
use the mounted CA mechanism for that mode. TLS must terminate at a trusted HTTPS
proxy and remain verified on database links.

`REALTIME_ENABLED=true` is the default. `REALTIME_DATABASE_URL` may specify a separate
session-mode connection; otherwise LISTEN uses `DATABASE_URL`. Transaction-pooling
endpoints cannot provide durable LISTEN subscriptions. A session connection and a
transaction-pooled query connection can be configured separately. Reconnects always
refetch persistent APIs; live delivery itself is not proof that a person read data.

`RATE_LIMIT_BACKEND` defaults to `postgres` in production and `memory` locally.
Production shared limiting requires an available migrated database and fails closed.
Memory mode is appropriate for isolated development/tests, not shared multi-instance
production limits. No proxy IP headers are used for identity.

Optional configuration:

- `AI_PROVIDER=mock` works without paid APIs. Set server-only `OPENAI_API_KEY` to use
  OpenAI, with optional bounded `OPENAI_MODEL`; provider failure retains local fallback.
- `ANALYTICS_ENABLED=false` is the default. Enabling records enumerated action counts,
  without profile/session identifiers, private content or individual attribution.
- `MODERATION_ADMIN_SECRET` enables moderator authentication; generate at least 32
  random base64url characters and keep it server-only. For example,
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
- `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` enable opt-in
  push only together and with a public HTTPS origin. Use standard unpadded base64url
  VAPID keys and a `mailto:operator@example.com` or HTTPS origin subject. Missing all
  keys leaves the inbox usable; partial configuration is an error. Browser permission,
  subscription and delivery remain separate steps.

## Migrations and release order

Back up the database before schema changes. Apply the checked migrations from the
same release exactly once as a separate deployment job, then roll out the web image.
The existing migration runner uses a PostgreSQL advisory lock, one transaction and
checksums; it refuses modified applied migrations. Never rewrite migrations 0001–0010.
Demo seeding is disabled in production.

```sh
# From a trusted checkout with runtime secrets already injected:
NODE_ENV=production npm run db:migrate
# Or from the operations image, with the same external runtime environment:
docker run --rm --init --env-file /secure/veya-runtime.env veya:operations
```

The operations target includes development CLI dependencies and source; do not use
it as the web runtime. A failed migration means the release must stop. Restore a
backup when required by your tested rollback procedure; deploying an older image
against newer schema is not automatically a safe rollback.

## Health, readiness and shutdown

`GET /api/health` returns a generic liveness response without parsing credentials
or opening a database connection. The Docker healthcheck uses this route. Configure
load-balancer readiness separately using `GET /api/ready`: it returns 200 only if
PostgreSQL is reachable and every migration version/checksum exactly matches this
release, otherwise a generic 503. Neither route returns connection details or errors;
both disable caching. Readiness never applies migrations.

Query connection acquisition is capped at 5 seconds, queries/statements at 10 seconds,
and idle pool connections at 30 seconds. On SIGTERM/SIGINT the Node instrumentation
starts cleanup for both the LISTEN hub and query pool, closes live subscriptions and
bounds application cleanup to 5 seconds. Next owns HTTP draining and process exit;
allow at least 15 seconds before an orchestrator sends SIGKILL. Cleanup is best effort
if the process is killed or Next exits sooner; committed PostgreSQL state remains the
source of truth. Operational logs use fixed event names and numeric counters only,
without raw errors, URLs, request bodies or identifiers.

## HTTPS proxy and SSE

Use your host's managed HTTPS load balancer or a trusted reverse proxy. An Nginx
location for API/event traffic should include:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 360s;
    proxy_send_timeout 360s;
}
```

Install/renew a valid public TLS certificate in the proxy configuration. Set a
connection limit appropriate to the instance and confirm that the actual proxy
preserves heartbeat/event chunks; CDN buffering and short idle timeouts can delay
live updates. Stream lifetimes and client retries are bounded; ordinary refresh and
persistent APIs remain available. Do not log Cookie, request bodies or recovery keys.

## Explicit workers and retention

Workers are explicit bounded invocations; the web request path does not install a
scheduler. Schedule them on your host only after checking runtime secrets and schema.
Use a non-root operations container/checkout and monitor generic success/failure
counts. Do not promise automatic push/reminders/candidate checks without a scheduler.

```sh
# One bounded batch of future candidates, reminders and opted-in push:
NODE_ENV=production npm run social:process
# Notifications alone:
NODE_ENV=production node --conditions=react-server --import tsx \
  scripts/notifications.ts --limit=20
# Inspect retention before applying it:
NODE_ENV=production npm run db:cleanup -- --dry-run
# Apply only after reviewing the dry run and a verified backup:
NODE_ENV=production npm run db:cleanup -- --apply
```

A notification batch accepts limits 1–100. Confirmed linked plans due within 24 hours
receive one reminder per match/start/recipient. Push jobs use claim leases, at most
five attempts and exponential retry; generic payloads contain no activity, location,
names or chat. Unavailable VAPID configuration keeps inbox/reminders working and push
jobs pending. Schedule frequent small batches and observe backlog before scaling.
Run `npm run social:process` every minute using a protected cron/systemd timer or
scheduled operations container. Candidate jobs use five-minute leases, at most five
attempts and a 20-job batch. Without scheduling there are no background candidate
notices or pushes. Candidate discovery never sends Interested automatically.
Retention defaults to dry run and limits each category to 100 records; schedule
small batches rather than unbounded deletion. Notifications expire after 30 days, outbox events after 24 hours, terminal worker
jobs and expired moderator sessions after seven days. Invalid push subscriptions
follow expired/revoked guest retention. Open/reviewing moderation cases protect their
evidence and context indefinitely; resolved/dismissed cases retain at least 365 days.
Moderator audit history is not automatically purged; define an operator policy. The limiter removes up to 100 expired buckets per check; `db:cleanup` also
removes a bounded batch of old buckets without touching active quotas; do not truncate active abuse budgets during normal operation.

## Backup, restore and verification

Use provider snapshots plus encrypted off-host logical backups with a retention
policy, restore permissions and a defined recovery objective. For a verified direct
PostgreSQL session, an operator can use:

```sh
# Set PG service/credentials through a protected service file or secret manager.
pg_dump --format=custom --file=/secure/backups/veya.dump
# Restore only into a separate empty recovery database, never over the live service.
pg_restore --no-owner --dbname=veya_restore /secure/backups/veya.dump
```

Regularly restore into an isolated environment, run migration checksum/readiness
checks and inspect application recovery. Record the restore duration and verify
that backup artifacts contain sensitive data and receive appropriate access controls.
Protect signing/moderation secrets separately from database backup material.

Local check/build/native database/browser tests and local Docker tests are evidence
for their tested checkout only. GitHub Actions is separate evidence and must be
reported from an actual run. Production HTTPS/database certificates, live browser
push, proxy streaming, real backups/restores and hosted scheduling require operator
verification; a successful local test does not verify them.
