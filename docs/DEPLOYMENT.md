# Running a Veya release

This release targets Node 24 and PostgreSQL. Deployment remains an operator action;
no production service or database is provisioned by the repository. Use a non-root
account for both the web container and native PostgreSQL test runner.

## Server prerequisites

Use a maintained Linux VPS or Node-capable host. For a small beta, start with
2 vCPU/4 GB RAM and enough free disk for PostgreSQL, protected backups and build
artifacts; allow at least 25 GB free if building both images on that host. Building
images in CI avoids production build contention. Install supported Node 24 LTS or
Docker and matching PostgreSQL backup tools. Run web/workers as a non-root service
user. Expose only HTTPS through the proxy; keep port 3000 on loopback and database
ports private. Apply host updates, firewall rules and certificate renewal before
inviting users. Size storage and connections from measured beta traffic.

## Build and runtime configuration

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:e2e -- --project=desktop --project=mobile
docker build --target runner -t veya:release .
docker build --target operations -t veya:operations .
bash scripts/docker-smoke.sh veya:release veya:operations
bash scripts/docker-database-smoke.sh veya:release veya:operations
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

## Minimum closed beta configuration

Required for inviting closed beta users:

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | `production` (both images set it) |
| `NEXT_PUBLIC_APP_URL` | Actual public HTTPS origin |
| `DATABASE_URL` | Server-only migrated PostgreSQL, verified TLS for remote hosts |
| `MODERATION_ADMIN_SECRET` | Random secret, assigned human moderator and response policy |

Operational defaults and optional integrations:

| Variable | Default / purpose |
| --- | --- |
| `DB_POOL_MAX` | 5; 1–20, include workers/migrations/LISTEN in connection budget |
| `DATABASE_SSL_MODE` | Verified TLS selected for remote production; explicit `verify-full` supported |
| `REALTIME_ENABLED` | `true`; set `false` for persistent API/manual refresh fallback |
| `REALTIME_DATABASE_URL` | Main database unless separate session-mode LISTEN URL is supplied |
| `RATE_LIMIT_BACKEND` | `postgres` in production; keep shared admission enabled |
| `BETA_SIGNUPS_ENABLED` | `true`; `false` pauses new social profiles, preserves existing users |
| `BETA_SEEKING_ENABLED` | `true`; `false` pauses new seeking posts |
| `BETA_READ_ONLY` | `false`; `true` pauses application mutations, candidate/reminder/push workers and retention `--apply` |
| `AI_PROVIDER` / `OPENAI_API_KEY` / `OPENAI_MODEL` | Mock / unset / local fallback; paid AI optional |
| `ANALYTICS_ENABLED` | `false`; optional aggregate funnel |
| `PUSH_VAPID_PUBLIC_KEY` / `PUSH_VAPID_PRIVATE_KEY` / `PUSH_VAPID_SUBJECT` | All unset; configure all three only for optional Web Push |

Boolean flags accept only `true` or `false`. Invalid configuration fails closed
without printing values. Read-only maintenance preserves reads, health/readiness,
existing session access, human moderation, block/report, profile deletion, recovery-key
revocation, session revocation and push opt-out. Retention dry-run and explicit
operator migration/verification jobs remain available. This is an application control,
not a database-enforced immutable state: quotas and safety actions still write.
Discovery is paused because it allocates identities/handles. Results serve existing
cached proposals without recomputing/persisting them; uncached results have no
proposals until maintenance ends. Connection reads preserve recorded status without
expiring requests. Apply changed flags to **both web and worker**
environments and restart them; an already-running invocation can finish current work.

Integration and credential details:

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
checksums; it refuses modified applied migrations. Never rewrite applied migrations 0001–0017; this release adds 0018.
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
without raw errors, URLs, request bodies or identifiers. Startup completion indicates
process initialization; use `/api/ready` to establish database/schema readiness.

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
Run `npm run social:process` every minute using the scheduler examples below. Candidate jobs use five-minute leases, at most five
attempts and a 20-job batch. Without scheduling there are no background candidate
notices or pushes. Candidate discovery never sends Interested automatically.
Retention defaults to dry run and limits each category to 100 records; schedule
small batches rather than unbounded deletion. Notifications expire after 30 days, outbox events after 24 hours, terminal worker
jobs and expired moderator sessions after seven days. Invalid push subscriptions
follow expired/revoked guest retention. Open/reviewing moderation cases protect their
evidence and context indefinitely; resolved/dismissed cases retain at least 365 days.
Moderator audit history is not automatically purged; define an operator policy. The limiter removes up to 100 expired buckets per check; `db:cleanup` also
removes a bounded batch of old buckets without touching active quotas; do not truncate active abuse budgets during normal operation.

## Scheduler and operational monitoring

A systemd oneshot/timer prevents overlapping executions of the same unit. Example
`/etc/systemd/system/veya-social.service` (protect the environment file and checkout):

```ini
[Unit]
Description=Veya bounded social worker
After=network-online.target
[Service]
Type=oneshot
User=veya
WorkingDirectory=/srv/veya
EnvironmentFile=/secure/veya-runtime.env
ExecStart=/usr/bin/node --conditions=react-server --import tsx scripts/social-worker.ts
TimeoutStartSec=270
TimeoutStopSec=20
KillSignal=SIGTERM
StandardOutput=journal
StandardError=journal
```

`/etc/systemd/system/veya-social.timer`:

```ini
[Unit]
Description=Run Veya social worker each minute
[Timer]
OnCalendar=*-*-* *:*:00
Persistent=true
[Install]
WantedBy=timers.target
```

After reviewing paths/permissions: `systemctl daemon-reload` and
`systemctl enable --now veya-social.timer`. For containers, an equivalent protected
cron entry can run `flock -n /var/lib/veya/social.lock docker run --rm --init
--stop-timeout 20 --env-file /secure/veya-runtime.env veya:operations npm run
social:process` every minute. Provision the lock directory for the scheduler user;
use one scheduler per database unless measured backlog requires concurrency. Durable
claims and dedupe support concurrent workers, but unnecessary overlap consumes pool
connections. Schedule retention separately: start with `--dry-run`; enable `--apply`
only after the owner selects a retention policy and verifies restoration.

CLI invocations have a four-minute work deadline. SIGTERM/SIGINT stops starting
new work, finishes the current transaction and releases still-owned unstarted leases
without consuming retry attempts. Draining has a ten-second work grace plus five-second
resource deadline; exit codes are 0 success/skipped, 1 failure/deadline, 130 SIGINT,
143 SIGTERM. Success means the bounded invocation completed; individual handled
job failures/retries remain in counters/queue status and may emit `worker_failed`
even when the invocation exits zero. Alert on both exit status and job failures.
A forced termination can leave current leases for normal recovery;
notification retries are at least once, so provider acceptance followed by a crashed
commit can produce a duplicate generic push. Inbox dedupe remains durable.

```sh
NODE_ENV=production npm run ops:status
journalctl -u veya-social.service --since '10 minutes ago'
systemctl list-timers veya-social.timer
```

`ops:status` verifies migration readiness and returns only candidate/push aggregate
pending/processing/failed/completed counts, expired leases, oldest pending age and
latest durable completion age. Completion age measures finished jobs, **not** the
last successful empty worker invocation; retention removes old terminal history.
Use scheduler run timestamps/exit status and `worker_exit` logs to detect a stalled
scheduler even with an empty queue. Disabled optional push can leave push backlog;
alerts must reflect configured features and read-only pauses.

Initial operator alerts: readiness continuously unavailable for two minutes; no
successful worker invocation for five minutes while enabled; increasing candidate
backlog/oldest age across five scheduled runs; any terminal failure or expired leases
persisting beyond a subsequent run; repeated `api_unavailable`, `database_unavailable`,
`database_idle_error`, `migration_failed`, `worker_failed` or `shutdown_failed` events.
Fixed event logs include process-local numeric occurrence counters; aggregate them in
the host's log monitor. Counters reset on process restart and are not cross-instance
metrics. Restrict log access; do not add request bodies/cookies, URL paths containing
bearer keys, connection strings, profile identifiers or raw driver/provider errors.
These are suggested closed-beta thresholds, to adjust after measuring real traffic.

## Backup and disaster recovery

Use provider snapshots plus encrypted off-host logical backups with a retention
policy, named recovery owner, recovery point objective and measured recovery time.
Install matching PostgreSQL client tools (same major or newer than the server).
The operations image includes Node CLIs; `pg_dump`/`pg_restore` are host/backup-job
requirements, not bundled web or operations tools.

Create a protected libpq service file outside the checkout, mode 0600, containing
separate `[production]` and `[restore]` entries. Each needs host, port, dbname, user
and verified TLS (`sslmode=verify-full`, trusted `sslrootcert` when required).
Supply passwords through a protected `.pgpass`/secret manager. The restore entry must
point at an **operator-created empty isolated database**, never the live database.

```sh
PGSERVICEFILE=/secure/veya-pg-services.conf PGSERVICE=production \
  npm run db:backup -- /secure/backups/veya-2026-10-02.dump
# Encrypt and copy off-host with your approved backup transport before expiring old backups.
PGSERVICEFILE=/secure/veya-pg-services.conf RESTORE_PGSERVICE=restore \
  npm run db:restore -- /secure/backups/veya-2026-10-02.dump
# Inject DATABASE_URL for that same isolated destination through its secret environment:
NODE_ENV=production npm run db:verify
```

Backup creates an owner-only custom archive, checks its table of contents, and
publishes without replacing an existing archive. A failed dump is not published.
Restore refuses nonempty destinations and uses one transaction, stops on errors,
and restores as the destination role without source owners/grants. Restrict destination
access and keep web/workers stopped: empty-database checks are a safety guard, not
proof that an operator-selected service is the correct target. Never restore an
untrusted archive. The scripts omit raw tool diagnostics from shared output;
operators diagnose PostgreSQL errors through their protected database tooling.
Database backups contain private content/recovery hashes and need encryption and
access controls. Protect signing/moderation secrets separately.
Record archive checksum, backup timestamp, release/schema version and expected
aggregate counts in a protected operator manifest; the scripts do not generate
that record or provision off-host storage automatically.

Before switching to a restored database:

1. Keep it isolated from public traffic and stop its workers. Disable AI/push and
   destructive retention during the rehearsal; do not deliver recovered queued
   notifications to real users as a test.
2. Run `db:verify` using the destination's secret environment. Compare schema,
   expected record counts and restore time with the backup manifest; check the
   release's readiness and two-user smoke using isolated test identities.
3. Reconcile deletions, revoked sessions/keys, blocks and moderation actions after
   the backup timestamp against surviving current data, WAL/PITR or a verified
   operator recovery record. A snapshot predating those changes restores old rows;
   there is no automatic external deletion/revocation journal in this release.
   If current safety state cannot be established, keep the recovery isolated for
   operator review instead of automatically reopening traffic.
4. With web/workers stopped, update both secret environments to the verified
   destination (including the LISTEN URL), restart the release and check health,
   readiness, secure cookies, chat access, blocks and moderator enforcement.
5. Inspect pending/failed jobs and scheduler logs before enabling delivery,
   candidate processing and the reviewed retention policy. Take a new protected
   backup and record the actual recovery point/time and any lost recent changes.

Deleted personal content can remain in encrypted historical backups until their
explicit expiry (the beta minimum below retains seven daily archives). Restrict
access, expire old copies consistently and follow the reconciliation procedure
above; profile deletion cannot retroactively rewrite an offline archive.

The disposable Docker smoke applies all release migrations twice, verifies checksums,
runs concurrent candidate workers against real PostgreSQL, checks notification dedupe
and absence of automatic interest, exercises ready/unavailable endpoints, performs a
logical backup/empty-database restore and verifies restored checksums/content. It creates
no published database port, uses no inherited database/provider credentials, and tears
down its containers. CI runs this in addition to the existing missing-database smoke.

## Sequential closed beta rollout

1. Verify the exact release checkout with clean dependency install, check/build,
   desktop/mobile browser tests, audit and both container smokes; observe hosted CI
   separately for the published commit.
2. Provision the HTTPS origin/proxy and PostgreSQL trusted server role/verified TLS;
   prepare protected web/worker/migration and backup-service secret environments.
   Assign a human moderator and report/escalation policy before inviting users.
3. Pause affected web writes/workers for schema maintenance as needed. Take a provider
   snapshot and protected logical backup. Rehearse restoration in an empty isolated
   database and record duration before relying on that rollback procedure.
4. Run the release operations image `db:migrate` as a separate job. Stop rollout on
   failure. Run `db:verify` against that database; never run demo seeding in production.
5. Start the web image behind HTTPS; verify liveness, readiness and actual browser
   secure cookies, SSE delivery/reconnect, moderator enforcement and private inbox.
6. Install and enable the worker timer with the same controls/secrets/schema. Check
   one real invocation, exit logs, queue status and scheduler health. Install reviewed
   retention/backup schedules and alert routing; optional push/OpenAI remain optional.
7. Test signup/seeking/read-only pauses on the actual host, including worker skips and
   retained safety actions; restore intended flag values on every process. Invite the
   closed beta cohort only after these checks and restore objectives are accepted.
8. During an incident pause signups/seeking or enable read-only, keep safety/reporting
   available, and use readiness/logs/aggregate queues to assess impact. Stop web/workers
   before a restore. Verify a separate recovered database before switching traffic;
   an older web image against a newer schema is not automatically a safe rollback.

Local/native/browser/container evidence applies to the tested checkout only. Hosted
CI, production TLS/database certificates, mobile/Safari behavior, actual proxy
streaming, off-host encrypted backups/restores, scheduler uptime and optional real
push-provider delivery require owner verification. No production deployment is
performed by this task.

## First-host smoke and real devices

Before inviting the cohort, use two isolated browsers/accounts for the complete
chess activity→Interested→Accept→live chat→Plan it→both availability→results→votes→
organizer confirmation journey. Verify inbox/unread state, incompatible activity/city
exclusion, block during chat, lost-session key recovery, key rotation/revocation,
profile deletion and continued peer closed history. Confirm two Incognito pairs use
different stable aliases/avatars and reveal no global profile identifiers.

On an actual iPhone (Safari) and Android (Chrome), check 320px-equivalent layout,
keyboard/form focus, datetime input/timezone, clipboard failure fallback, memory-only
key warning, background/foreground reconnect, network loss/restoration and chat
updates. Confirm HTTPS Secure/HttpOnly cookies and readable loading/error/empty
states without horizontal overflow. For optional push, check unsupported/denied
fallback, explicit opt-in/opt-out, privacy-minimal lock-screen text and actual
delivery; iPhone Web Push may require an installed home-screen web app. Desktop
Chromium emulation does not prove these device/Safari behaviors.

Suggested beta schedules: combined social processing every minute; notifications
alone every minute only if a separate delivery worker is needed (the combined job
already includes it); retention preview daily, apply daily only after an explicit
reviewed policy; protected off-host backup daily, retain at least seven recent daily
archives, and rehearse an isolated restore monthly and before major migrations.
Monitor scheduler exit status and queue age, not just web health.

## Public brand compatibility

The Russian website now uses the public brand **Intavro** (formerly Veya). The repository,
package name, existing `veya_guest` and moderator cookies, migration tracking table,
SSE database channel/advisory-lock namespaces and draft event/storage keys remain
unchanged for compatibility. Existing sessions, recovery keys and invitation URLs do
not require replacement. Choose an available domain, verify trademark suitability,
and configure the actual HTTPS origin; no domain purchase or deployment was performed.
