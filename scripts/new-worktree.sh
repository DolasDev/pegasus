#!/usr/bin/env bash
# =============================================================================
# new-worktree.sh — Provision an isolated git worktree + Postgres for a
#                   Claude Code / parallel development session.
#
# Usage: scripts/new-worktree.sh <slug>
#
# Creates:
#   ../pegasus-<slug>           — git worktree on branch <slug> from origin/main
#   pegasus-pg-<slug>           — Docker container (postgres:16) on a stable port
#   ../pegasus-<slug>/apps/api/.env           — DATABASE_URL/DIRECT_URL pointing at isolated DB
#   ../pegasus-<slug>/apps/e2e/.env.test      — DATABASE_URL pointing at isolated DB
#
# Tear down with: scripts/rm-worktree.sh <slug>
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${BLUE}ℹ${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
fail() { echo -e "${RED}✘${RESET}  $*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Cleanup trap — fires on any error after worktree creation ────────────────
# SLUG, WORKTREE_PATH, CONTAINER_NAME are set before the trap is armed below.
_WORKTREE_CREATED=false
_cleanup_on_error() {
  local exit_code=$?
  [[ $exit_code -eq 0 ]] && return
  echo -e "\n${RED}${BOLD}✘ Provisioning failed (exit $exit_code).${RESET}" >&2
  if [[ "$_WORKTREE_CREATED" == "true" ]]; then
    echo -e "  Partial state may remain. Clean up with:" >&2
    echo -e "    ${BOLD}scripts/rm-worktree.sh ${SLUG:-<slug>}${RESET}" >&2
  fi
}
trap '_cleanup_on_error' EXIT

echo -e "\n${BOLD}Pegasus — New Worktree Provisioner${RESET}\n"

# ── Validate slug arg ────────────────────────────────────────────────────────

SLUG="${1:-}"
if [[ -z "$SLUG" ]]; then
  echo -e "Usage: $(basename "$0") <slug>" >&2
  echo -e "  <slug>  A short lowercase identifier for this worktree (e.g. feature-foo, probe)" >&2
  echo -e "          Must match: [a-z0-9][a-z0-9-]*" >&2
  exit 1
fi

if ! [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  fail "Invalid slug '$SLUG'. Must match: [a-z0-9][a-z0-9-]* (lowercase letters, digits, hyphens; no leading hyphen)"
fi

WORKTREE_PATH="$(dirname "$REPO_ROOT")/pegasus-${SLUG}"
BRANCH_NAME="$SLUG"
CONTAINER_NAME="pegasus-pg-${SLUG}"

# ── Guard: branch / worktree already exists ──────────────────────────────────

if git -C "$REPO_ROOT" worktree list --porcelain | grep -qF "worktree $WORKTREE_PATH"; then
  warn "Worktree already exists at $WORKTREE_PATH"
  warn "Remove it first with:  scripts/rm-worktree.sh $SLUG"
  exit 1
fi

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  warn "Branch '$BRANCH_NAME' already exists locally."
  warn "Remove it first with:  git branch -D $BRANCH_NAME  (or use rm-worktree.sh $SLUG)"
  exit 1
fi

# ── Node 24 via nvm ─────────────────────────────────────────────────────────

echo -e "\n${BOLD}Node version${RESET}"
WANT_NODE="$(cat "$REPO_ROOT/.nvmrc" 2>/dev/null || echo '24')"

# Source nvm if available
if [[ -z "$(command -v nvm 2>/dev/null)" ]]; then
  # Try common nvm locations
  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh"
  fi
fi

if command -v nvm &>/dev/null; then
  nvm use "$WANT_NODE" 2>/dev/null || warn "nvm could not switch to node $WANT_NODE — continuing with current node ($(node -v 2>/dev/null || echo 'unknown'))"
else
  warn "nvm not found — continuing with current node ($(node -v 2>/dev/null || echo 'unknown'))"
  warn "If node is not $WANT_NODE, install it: nvm install $WANT_NODE && nvm use $WANT_NODE"
fi

HAVE_NODE="$(node -v 2>/dev/null | sed 's/^v//' || echo '')"
if [[ -n "$HAVE_NODE" ]]; then
  ok "node $HAVE_NODE"
else
  warn "Could not determine node version"
fi

# ── Derive per-slug port (stable, reproducible) ──────────────────────────────

# Compute a simple hash: sum of character ordinals, mod 60, offset from 5433
# Range: 5433–5492. Avoids 5432 (shared Docker compose DB).
PORT_OFFSET=0
for ((i = 0; i < ${#SLUG}; i++)); do
  c="${SLUG:$i:1}"
  PORT_OFFSET=$((PORT_OFFSET + $(printf '%d' "'$c")))
done
PORT=$((5433 + (PORT_OFFSET % 60)))
DB_URL="postgresql://pegasus:pegasus@localhost:${PORT}/pegasus"

info "Derived Postgres port for slug '${SLUG}': ${PORT} (container: ${CONTAINER_NAME})"

# ── Fetch + create worktree ──────────────────────────────────────────────────

echo -e "\n${BOLD}Git worktree${RESET}"
info "Fetching origin..."
git -C "$REPO_ROOT" fetch origin

info "Creating worktree at $WORKTREE_PATH on branch $BRANCH_NAME (from origin/main)..."
git -C "$REPO_ROOT" worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" origin/main
_WORKTREE_CREATED=true
ok "Worktree created: $WORKTREE_PATH"

# ── Start isolated Postgres container ────────────────────────────────────────

echo -e "\n${BOLD}Postgres container${RESET}"

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  # Container exists — ensure it is running
  CONTAINER_STATUS="$(docker inspect --format '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo 'unknown')"
  if [[ "$CONTAINER_STATUS" == "running" ]]; then
    ok "Container $CONTAINER_NAME already running — reusing"
  else
    info "Container $CONTAINER_NAME exists but is not running (status: $CONTAINER_STATUS) — starting it..."
    docker start "$CONTAINER_NAME" >/dev/null
    ok "Container $CONTAINER_NAME started"
  fi
else
  # Guard: detect port collision with a different slug's container before attempting docker run.
  # The hash (sum of ordinals % 60) is a simple mapping and anagram slugs collide.
  CONFLICTING_CONTAINER="$(docker ps -a --format '{{.Names}} {{.Ports}}' | grep "0.0.0.0:${PORT}->" | awk '{print $1}' | head -1 || true)"
  if [[ -n "$CONFLICTING_CONTAINER" ]]; then
    fail "Port $PORT is already allocated by container '$CONFLICTING_CONTAINER'. Choose a different slug (port collisions happen with anagram slugs). Current port assignment: $PORT"
  fi
  info "Starting new Postgres container $CONTAINER_NAME on port $PORT..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER=pegasus \
    -e POSTGRES_PASSWORD=pegasus \
    -e POSTGRES_DB=pegasus \
    -p "${PORT}:5432" \
    postgres:16 \
    >/dev/null
  ok "Container $CONTAINER_NAME started"
fi

# ── Wait for Postgres readiness ───────────────────────────────────────────────

info "Waiting for Postgres to be ready (up to 30s)..."
READY=false
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U pegasus -d pegasus -q 2>/dev/null; then
    READY=true
    break
  fi
  sleep 1
done

if [[ "$READY" != "true" ]]; then
  fail "Postgres container $CONTAINER_NAME did not become ready in 30s. Check: docker logs $CONTAINER_NAME"
fi
ok "Postgres is accepting connections on port $PORT"

# ── Write env files into the new worktree ────────────────────────────────────

echo -e "\n${BOLD}Environment files${RESET}"

API_ENV_DIR="$WORKTREE_PATH/apps/api"
E2E_ENV_DIR="$WORKTREE_PATH/apps/e2e"

# ── apps/api/.env ─────────────────────────────────────────────────────────

API_ENV_FILE="$API_ENV_DIR/.env"

# Start from the current worktree's .env if it exists (carries real secrets),
# otherwise fall back to the example. We will overwrite DATABASE_URL/DIRECT_URL.
SRC_API_ENV="$REPO_ROOT/apps/api/.env"
EXAMPLE_API_ENV="$REPO_ROOT/apps/api/.env.example"

if [[ -f "$SRC_API_ENV" ]]; then
  # Copy existing .env then patch the two URL lines
  cp "$SRC_API_ENV" "$API_ENV_FILE"
  # Replace or add DATABASE_URL
  if grep -q '^DATABASE_URL=' "$API_ENV_FILE"; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"${DB_URL}\"|" "$API_ENV_FILE"
  else
    echo "DATABASE_URL=\"${DB_URL}\"" >> "$API_ENV_FILE"
  fi
  # Replace or add DIRECT_URL
  if grep -q '^DIRECT_URL=' "$API_ENV_FILE"; then
    sed -i "s|^DIRECT_URL=.*|DIRECT_URL=\"${DB_URL}\"|" "$API_ENV_FILE"
  else
    echo "DIRECT_URL=\"${DB_URL}\"" >> "$API_ENV_FILE"
  fi
  ok "apps/api/.env — copied from current worktree + URLs patched"
elif [[ -f "$EXAMPLE_API_ENV" ]]; then
  cp "$EXAMPLE_API_ENV" "$API_ENV_FILE"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"${DB_URL}\"|" "$API_ENV_FILE"
  sed -i "s|^DIRECT_URL=.*|DIRECT_URL=\"${DB_URL}\"|" "$API_ENV_FILE"
  ok "apps/api/.env — created from .env.example + URLs patched"
else
  # Minimal fallback
  cat > "$API_ENV_FILE" <<ENVEOF
DATABASE_URL="${DB_URL}"
DIRECT_URL="${DB_URL}"
NODE_ENV=development
DOCUMENTS_BUCKET_NAME=pegasus-documents-local
ENVEOF
  ok "apps/api/.env — created minimal fallback (no .env or .env.example found)"
fi

# ── apps/e2e/.env.test ────────────────────────────────────────────────────

E2E_ENV_FILE="$E2E_ENV_DIR/.env.test"

SRC_E2E_ENV="$REPO_ROOT/apps/e2e/.env.test"
EXAMPLE_E2E_ENV="$REPO_ROOT/apps/e2e/.env.test.example"

if [[ -f "$SRC_E2E_ENV" ]]; then
  cp "$SRC_E2E_ENV" "$E2E_ENV_FILE"
  if grep -q '^DATABASE_URL=' "$E2E_ENV_FILE"; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"${DB_URL}\"|" "$E2E_ENV_FILE"
  else
    echo "DATABASE_URL=\"${DB_URL}\"" >> "$E2E_ENV_FILE"
  fi
  if grep -q '^DIRECT_URL=' "$E2E_ENV_FILE"; then
    sed -i "s|^DIRECT_URL=.*|DIRECT_URL=\"${DB_URL}\"|" "$E2E_ENV_FILE"
  else
    echo "DIRECT_URL=\"${DB_URL}\"" >> "$E2E_ENV_FILE"
  fi
  ok "apps/e2e/.env.test — copied from current worktree + URLs patched"
elif [[ -f "$EXAMPLE_E2E_ENV" ]]; then
  # Extract only non-secret lines from the example (local target block)
  grep -v '^#\s*=== remote\|^# E2E_COGNITO\|^# WEB_URL\|^# E2E_API_BASE\|^# E2E_STAGING' \
    "$EXAMPLE_E2E_ENV" > "$E2E_ENV_FILE" 2>/dev/null || cp "$EXAMPLE_E2E_ENV" "$E2E_ENV_FILE"
  if grep -q '^DATABASE_URL=' "$E2E_ENV_FILE"; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"${DB_URL}\"|" "$E2E_ENV_FILE"
  else
    echo "DATABASE_URL=\"${DB_URL}\"" >> "$E2E_ENV_FILE"
  fi
  if grep -q '^DIRECT_URL=' "$E2E_ENV_FILE"; then
    sed -i "s|^DIRECT_URL=.*|DIRECT_URL=\"${DB_URL}\"|" "$E2E_ENV_FILE"
  else
    echo "DIRECT_URL=\"${DB_URL}\"" >> "$E2E_ENV_FILE"
  fi
  ok "apps/e2e/.env.test — created from .env.test.example + URLs patched"
else
  # Minimal fallback
  cat > "$E2E_ENV_FILE" <<ENVEOF
DATABASE_URL="${DB_URL}"
DIRECT_URL="${DB_URL}"
TEST_TENANT_ID="e2e00000-0000-0000-0000-000000000001"
DEFAULT_TENANT_ID="e2e00000-0000-0000-0000-000000000001"
SKIP_AUTH=true
PORT=3001
HOST=0.0.0.0
NODE_ENV=test
ENVEOF
  ok "apps/e2e/.env.test — created minimal fallback (no .env.test or .env.test.example found)"
fi

# ── npm install in the new worktree ──────────────────────────────────────────

echo -e "\n${BOLD}Dependencies${RESET}"
info "Running npm install in $WORKTREE_PATH..."
(cd "$WORKTREE_PATH" && npm install --loglevel=warn)
ok "npm install complete"

# ── Apply schema migrations ───────────────────────────────────────────────────

echo -e "\n${BOLD}Database migrations${RESET}"
info "Running prisma migrate deploy against port $PORT..."
(
  cd "$WORKTREE_PATH/apps/api"
  DATABASE_URL="$DB_URL" DIRECT_URL="$DB_URL" \
    node ../../node_modules/.bin/prisma migrate deploy
)
ok "Migrations applied to isolated DB (port $PORT)"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}✔ Worktree ready.${RESET}"
echo ""
echo -e "  ${BOLD}Worktree:${RESET}  $WORKTREE_PATH"
echo -e "  ${BOLD}Branch:${RESET}    $BRANCH_NAME  (based on origin/main)"
echo -e "  ${BOLD}DB port:${RESET}   $PORT  (container: $CONTAINER_NAME)"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "    cd $WORKTREE_PATH"
echo -e "    npm run dev           # start the full stack"
echo -e "    npm test              # run tests against the isolated DB"
echo ""
echo -e "  ${BOLD}Tear down:${RESET}"
echo -e "    scripts/rm-worktree.sh $SLUG"
echo ""
