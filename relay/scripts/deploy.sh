#!/usr/bin/env bash
# Tests locally, copies the source to the server over ssh, and rebuilds and
# restarts the container there.
#
#   DEPLOY_HOST=user@server npm run deploy
#
# DEPLOY_PATH   where it lives on the server, relative to that user's home (default easynote-relay)
# DEPLOY_URL    what to check afterwards (default https://relay.easynote.tayfai.tech/healthz)
#
# Only source travels. .env stays on the server, written once by hand and never
# overwritten, and the database lives in a docker volume.
set -euo pipefail

: "${DEPLOY_HOST:?set DEPLOY_HOST, e.g. DEPLOY_HOST=user@server}"
DEPLOY_PATH="${DEPLOY_PATH:-easynote-relay}"
DEPLOY_URL="${DEPLOY_URL:-https://relay.easynote.tayfai.tech/healthz}"

cd "$(dirname "$0")/.."

echo "› tests and type check"
npm test --silent
npx tsc --noEmit

# a login shell, so docker is on PATH however it was installed
remote() { ssh "$DEPLOY_HOST" "bash -lc $(printf '%q' "$1")"; }

echo "› checking the server"
remote "test -f '$DEPLOY_PATH/.env'" || {
  echo "no $DEPLOY_PATH/.env on $DEPLOY_HOST — create it first (see README, 'First deploy')" >&2
  exit 1
}

echo "› copying"
rsync -az --delete src/ "$DEPLOY_HOST:$DEPLOY_PATH/src/"
rsync -az Dockerfile .dockerignore docker-compose.yml package.json package-lock.json tsconfig.json "$DEPLOY_HOST:$DEPLOY_PATH/"

echo "› building and restarting"
remote "cd '$DEPLOY_PATH' && docker compose up -d --build && docker image prune -f >/dev/null"

echo "› health check"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "$DEPLOY_URL" >/dev/null 2>&1; then echo "up: $DEPLOY_URL"; exit 0; fi
  sleep 3
done
echo "deployed, but $DEPLOY_URL did not answer — check: ssh $DEPLOY_HOST 'cd $DEPLOY_PATH && docker compose logs --tail 50'" >&2
exit 1
