#!/usr/bin/env bash
set -euo pipefail

# Real image execution: catches non-root permissions and missing CLI/runtime files.
runner_image="${1:-veya:smoke}"
operations_image="${2:-veya:operations-smoke}"
smoke_container="veya-release-smoke-$$"
smoke_logs="$(mktemp -d)"
cleanup() {
  docker rm --force "$smoke_container" >/dev/null 2>&1 || true
  rm -rf "$smoke_logs"
}
trap cleanup EXIT

[[ "$(docker image inspect --format '{{.Config.User}}' "$runner_image")" == node ]]
[[ "$(docker image inspect --format '{{.Config.User}}' "$operations_image")" == node ]]
docker run --detach --name "$smoke_container" \
  --env NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 "$runner_image" >/dev/null
[[ "$(docker exec "$smoke_container" id -u)" == 1000 ]]
docker exec "$smoke_container" node --input-type=module -e '
  let health;
  for (let attempt=0; attempt<20; attempt++) {
    try { health=await fetch("http://127.0.0.1:3000/api/health"); if(health.ok)break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!health?.ok || (await health.json()).status!=="ok")process.exit(1);
  const ready=await fetch("http://127.0.0.1:3000/api/ready");
  if(ready.status!==503 || (await ready.json()).status!=="unavailable" ||
      !ready.headers.get("cache-control")?.includes("no-store"))process.exit(1);
'

# No DB credentials: each CLI must reach its safe configuration failure, rather
# than failing to read package/source files or silently selecting another DB.
if docker run --rm --env NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 \
  "$operations_image" >"$smoke_logs/migrate.log" 2>&1; then
  cat "$smoke_logs/migrate.log"
  exit 1
fi
rg --quiet --fixed-strings 'Database command failed.' "$smoke_logs/migrate.log"
if docker run --rm --env NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 \
  "$operations_image" npm run social:process >"$smoke_logs/worker.log" 2>&1; then
  cat "$smoke_logs/worker.log"
  exit 1
fi
rg --quiet --fixed-strings 'Social worker unavailable.' "$smoke_logs/worker.log"
# Give the instrumentation/Next shutdown path its normal grace period.
docker stop --timeout 15 "$smoke_container" >/dev/null
printf '%s\n' 'Non-root runner and operations smoke passed.'
