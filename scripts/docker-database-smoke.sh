#!/usr/bin/env bash
set -euo pipefail

# Everything below belongs to disposable containers; never uses inherited DB URLs.
runner_image="${1:-veya:smoke}"
operations_image="${2:-veya:operations-smoke}"
postgres_image="${3:-postgres:18-bookworm}"
smoke_prefix="veya-db-smoke-$$"
smoke_tmp="$(mktemp -d)"
cleanup() {
  docker rm --force "$smoke_prefix-web" "$smoke_prefix-operations" "$smoke_prefix-db" >/dev/null 2>&1 || true
  rm -rf "$smoke_tmp"
}
trap cleanup EXIT
umask 077
smoke_password="$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')"
cat > "$smoke_tmp/database.env" <<ENV
POSTGRES_USER=veya_smoke
POSTGRES_PASSWORD=$smoke_password
POSTGRES_DB=veya_smoke
ENV
cat > "$smoke_tmp/runtime.env" <<ENV
NODE_ENV=production
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
DATABASE_URL=postgresql://veya_smoke:$smoke_password@127.0.0.1:5432/veya_smoke
REALTIME_DATABASE_URL=postgresql://veya_smoke:$smoke_password@127.0.0.1:5432/veya_smoke
AI_PROVIDER=mock
RATE_LIMIT_BACKEND=postgres
BETA_READ_ONLY=false
ENV
# No published database port and no external network; app joins this network namespace.
docker run --detach --name "$smoke_prefix-db" --network none --env-file "$smoke_tmp/database.env" "$postgres_image" >/dev/null
for attempt in {1..60}; do
  if docker exec "$smoke_prefix-db" pg_isready --username=veya_smoke --dbname=veya_smoke >/dev/null 2>&1; then break; fi
  if [[ "$attempt" == 60 ]]; then exit 1; fi
  sleep 1
done
# Reuse the image filesystem, particularly on vfs Docker drivers. Each exec starts
# an independent CLI process/pool; concurrent workers still coordinate only via PG.
docker run --detach --init --name "$smoke_prefix-operations" --network "container:$smoke_prefix-db" \
  --env-file "$smoke_tmp/runtime.env" "$operations_image" sleep infinity >/dev/null
[[ "$(docker exec "$smoke_prefix-operations" id -u)" == 1000 ]]
operations() {
  docker exec "$smoke_prefix-operations" "$@"
}
operations npm run db:migrate
operations npm run db:migrate
operations npm run db:verify
# Direct fixture contains no production identity/credentials and exercises persisted matching.
docker exec -i "$smoke_prefix-db" psql --username=veya_smoke --dbname=veya_smoke --no-psqlrc --set=ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO social_profiles(id,alias,privacy_mode,avatar_seed,adult_confirmed,languages)
VALUES ('00000000-0000-4000-8000-000000000001','Smoke A','INCOGNITO',repeat('a',32),true,ARRAY['en']),
       ('00000000-0000-4000-8000-000000000002','Smoke B','INCOGNITO',repeat('b',32),true,ARRAY['en']);
INSERT INTO seeking_posts(id,public_key,profile_id,active_slot,raw_text,activity_key,activity_label,interaction_mode,format,skill,languages,privacy_mode,expires_at)
SELECT id,CASE WHEN alias='Smoke A' THEN repeat('a',24) ELSE repeat('b',24) END,id,1,'Play chess','chess','Chess','online','one_to_one','any',ARRAY['en'],'INCOGNITO',clock_timestamp()+interval '7 days' FROM social_profiles;
INSERT INTO seeking_availability(post_id,slot,start_at,end_at) SELECT id,1,clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour' FROM seeking_posts;
INSERT INTO social_candidate_jobs(post_id) SELECT id FROM seeking_posts;
SQL
operations npm run social:process > "$smoke_tmp/worker-a.log" 2>&1 &
worker_a=$!
operations npm run social:process > "$smoke_tmp/worker-b.log" 2>&1 &
worker_b=$!
wait "$worker_a"
wait "$worker_b"
operations npm run social:process
operations npm run notifications:process
operations npm run db:cleanup -- --dry-run
[[ "$(docker exec "$smoke_prefix-db" psql --username=veya_smoke --dbname=veya_smoke --no-psqlrc -Atc "SELECT (SELECT count(*) FROM social_notifications WHERE type='CANDIDATE_FOUND')||':'||(SELECT count(*) FROM social_candidate_jobs WHERE status='completed')||':'||(SELECT count(*) FROM connection_requests)")" == '2:2:0' ]]
docker run --detach --name "$smoke_prefix-web" --network "container:$smoke_prefix-db" --env-file "$smoke_tmp/runtime.env" "$runner_image" >/dev/null
[[ "$(docker exec "$smoke_prefix-web" id -u)" == 1000 ]]
docker exec "$smoke_prefix-web" node --input-type=module -e '
  let ready;
  for(let attempt=0;attempt<30;attempt++) {
    try { ready=await fetch("http://127.0.0.1:3000/api/ready"); if(ready.ok)break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!ready?.ok || (await ready.json()).status!=="ready")process.exit(1);
  const preview=await fetch("http://127.0.0.1:3000/opengraph-image");
  const image=new Uint8Array(await preview.arrayBuffer());
  if(!preview.ok || !preview.headers.get("content-type")?.includes("image/png") ||
      !preview.headers.get("cache-control")?.includes("no-store") || image.byteLength<1000 ||
      image.slice(0,8).join(",")!=="137,80,78,71,13,10,26,10")process.exit(1);
'
# Rehearse the actual protected-service tooling against an empty, separate DB.
docker exec "$smoke_prefix-db" createdb --username=veya_smoke veya_restore
docker cp scripts/backup.sh "$smoke_prefix-db:/tmp/backup.sh" >/dev/null
docker cp scripts/restore.sh "$smoke_prefix-db:/tmp/restore.sh" >/dev/null
cat > "$smoke_tmp/pg_service.conf" <<ENV
[source]
host=127.0.0.1
port=5432
user=veya_smoke
password=$smoke_password
dbname=veya_smoke
[restore]
host=127.0.0.1
port=5432
user=veya_smoke
password=$smoke_password
dbname=veya_restore
ENV
docker cp "$smoke_tmp/pg_service.conf" "$smoke_prefix-db:/tmp/pg_service.conf" >/dev/null
docker exec "$smoke_prefix-db" chmod 600 /tmp/pg_service.conf
docker exec --env PGSERVICEFILE=/tmp/pg_service.conf --env PGSERVICE=source "$smoke_prefix-db" bash /tmp/backup.sh /tmp/veya.dump
# Refuse replacing an existing archive, and refuse restore over a populated DB.
if docker exec --env PGSERVICEFILE=/tmp/pg_service.conf --env PGSERVICE=source "$smoke_prefix-db" bash /tmp/backup.sh /tmp/veya.dump >/dev/null 2>&1; then exit 1; fi
docker exec --env PGSERVICEFILE=/tmp/pg_service.conf --env RESTORE_PGSERVICE=restore "$smoke_prefix-db" bash /tmp/restore.sh /tmp/veya.dump
if docker exec --env PGSERVICEFILE=/tmp/pg_service.conf --env RESTORE_PGSERVICE=source "$smoke_prefix-db" bash /tmp/restore.sh /tmp/veya.dump >/dev/null 2>&1; then exit 1; fi
sed 's@/veya_smoke$@/veya_restore@' "$smoke_tmp/runtime.env" > "$smoke_tmp/restore.env"
docker exec --env-file "$smoke_tmp/restore.env" "$smoke_prefix-operations" npm run db:verify
[[ "$(docker exec "$smoke_prefix-db" psql --username=veya_smoke --dbname=veya_restore --no-psqlrc -Atc "SELECT count(*) FROM social_notifications WHERE type='CANDIDATE_FOUND'")" == 2 ]]
# Missing-table readiness must fail safely; checksums can be corrupted in this disposable fixture.
docker exec "$smoke_prefix-db" psql --username=veya_smoke --dbname=veya_smoke --no-psqlrc -c "UPDATE veya_schema_migrations SET checksum='bad'" >/dev/null
docker exec "$smoke_prefix-web" node -e 'fetch("http://127.0.0.1:3000/api/ready").then(r=>process.exit(r.status===503?0:1))'
docker stop --timeout 20 "$smoke_prefix-web" >/dev/null
printf '%s\n' 'Isolated PostgreSQL migrations, concurrent workers, readiness and backup/restore passed.'
