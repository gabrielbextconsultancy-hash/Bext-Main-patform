#!/usr/bin/env bash
#
# Deploy ring 0 (Uptime Kuma) and the self-healing env into the BEXT stack.
#
#   bash infra/deploy-self-healing.sh          # do it
#   bash infra/deploy-self-healing.sh --dry    # print what it would do
#
# Run from the repo root, on a machine whose .env has VPS_HOST and VPS_SSH_KEY.
#
# ── what it will and will not touch ─────────────────────────────────────────
#
# Touches: /docker/bext/.env, /docker/bext/docker-compose.yml, and the bext
# compose project. Backs both files up first, and only APPENDS env keys that are
# missing — an existing value always wins, so a working secret is never
# overwritten by a blank from the template.
#
# Never touches /docker/n8n (Premier Fitness) or /opt/nfac. Every docker command
# below is scoped `-p bext` and names its service explicitly.
#
# Idempotent. Running it twice is a no-op plus a fresh backup.
set -euo pipefail

cd "$(dirname "$0")/.."
DRY=${1:-}

HOST=$(grep -E '^VPS_HOST=' .env | cut -d= -f2 | tr -d '\r')
KEY=$(grep -E '^VPS_SSH_KEY=' .env | cut -d= -f2 | tr -d '\r' | sed "s|^~|$HOME|")
[ -n "$HOST" ] && [ -n "$KEY" ] || { echo "VPS_HOST / VPS_SSH_KEY not in .env"; exit 1; }

SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "root@$HOST")
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ── 1. the env fragment ─────────────────────────────────────────────────────
# The push tokens are deliberately blank: they do not exist until the monitors
# are created in the Kuma UI (see docs/SELF-HEALING.md § Monitors). A blank
# token makes the Heartbeat node a harmless no-op — it does NOT fail the
# workflow, because the node carries onError: continueRegularOutput.
{
  echo ""
  echo "# ── self-healing (docs/SELF-HEALING.md) ──"
  grep -E '^N8N_API_KEY=' .env | tr -d '\r' || echo "N8N_API_KEY="
  echo "KUMA_SUBDOMAIN=bext-kuma"
  echo "KUMA_PUSH_BASE=http://uptime-kuma:3001/api/push"
  for k in SOURCE_INGEST ARTICLE_ANALYSIS DAILY_REPORT DAILY_NEWS_CARD \
           GRAPH_HEALTH MEETING_INTAKE SELF_HEAL CONTRACT_TEST; do
    echo "KUMA_PUSH_${k}="
  done
} > "$TMP/env-add.txt"

if [ "$DRY" = "--dry" ]; then
  echo "would ship infra/docker-compose.yml and $(grep -c = "$TMP/env-add.txt") env keys to $HOST"
  echo "would run: docker compose -p bext up -d uptime-kuma n8n"
  sed 's/^N8N_API_KEY=.*/N8N_API_KEY=<redacted>/' "$TMP/env-add.txt"
  exit 0
fi

# ── 2. ship ─────────────────────────────────────────────────────────────────
# The repo nests services under infra/ (`build: ../dashboard`); the VPS layout is
# flat. Ship the compose without this rewrite and `../dashboard` resolves to
# /docker/dashboard — a stale directory that still exists — so every later rebuild
# compiles old source and succeeds while changing nothing. That cost us the
# mind-map slide in 055ea12. .github/workflows/deploy.yml does the same rewrite;
# preflight R032 asserts this line is still here.
sed 's#build: \.\./#build: ./#' infra/docker-compose.yml > "$TMP/docker-compose.yml"

scp -i "$KEY" -o BatchMode=yes "$TMP/env-add.txt"        "root@$HOST:/tmp/env-add.txt"
scp -i "$KEY" -o BatchMode=yes "$TMP/docker-compose.yml" "root@$HOST:/tmp/docker-compose.yml"

# ── 3. apply ────────────────────────────────────────────────────────────────
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /docker/bext

STAMP=$(date +%Y%m%d-%H%M%S)
cp .env ".env.bak-$STAMP"
cp docker-compose.yml "docker-compose.yml.bak-$STAMP"
echo "backed up: .env.bak-$STAMP / docker-compose.yml.bak-$STAMP"

added=0
while IFS= read -r line; do
  case "$line" in
    ''|'#'*) printf '%s\n' "$line" >> .env; continue;;
  esac
  k="${line%%=*}"
  if grep -qE "^${k}=" .env; then
    echo "  keep existing $k"
  else
    printf '%s\n' "$line" >> .env
    added=$((added+1))
  fi
done < /tmp/env-add.txt
echo "added $added env keys"

cp /tmp/docker-compose.yml docker-compose.yml
docker compose -p bext config -q
echo "compose validates"

# uptime-kuma is new; n8n restarts to pick up N8N_API_KEY and the KUMA_PUSH_*
# vars. Both named explicitly — a bare `up -d` would recreate every service,
# including the 6 GB ollama, on an 8 GB host shared with two other projects.
docker compose -p bext up -d uptime-kuma n8n

echo "--- bext project ---"
docker compose -p bext ps --format "{{.Name}}\t{{.Status}}"
echo "--- Premier Fitness, untouched ---"
docker compose -p n8n ps --format "{{.Name}}\t{{.Status}}"
REMOTE

echo
echo "Next: create the Kuma admin account and the monitors."
echo "  docs/SELF-HEALING.md § Monitors has the full list and the windows."
