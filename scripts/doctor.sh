#!/usr/bin/env bash
# =============================================================================
# doctor.sh — Local environment triage (read-only, mutates nothing)
#
# Runs every check, one line each, and exits non-zero if any FAIL.
# Each FAIL prints the exact command that fixes it.
#
# Override the postgres probe target (e.g. to test the failure path without
# touching the shared container): PEGASUS_PG_HOST / PEGASUS_PG_PORT.
# =============================================================================

set -uo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

FAILURES=0

pass() { echo -e "${GREEN}PASS${RESET}  $1"; }
fail() {
  echo -e "${RED}FAIL${RESET}  $1"
  echo -e "      ${BOLD}fix:${RESET} $2"
  FAILURES=$((FAILURES + 1))
}
warn() { echo -e "${YELLOW}WARN${RESET}  $1"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

echo -e "\n${BOLD}Pegasus — Environment Doctor${RESET}\n"

# ── Node version matches .nvmrc ──────────────────────────────────────────────
WANT_NODE="$(cat .nvmrc 2>/dev/null || echo '')"
HAVE_NODE="$(node -v 2>/dev/null | sed 's/^v//')"
if [[ -n "$WANT_NODE" && "$HAVE_NODE" == "$WANT_NODE" ]]; then
  pass "node $HAVE_NODE matches .nvmrc"
else
  fail "node is '${HAVE_NODE:-not found}', .nvmrc wants $WANT_NODE" "nvm install \$(cat .nvmrc) && nvm use"
fi

# ── npm major version ≥ 10 ───────────────────────────────────────────────────
NPM_MAJOR="$(npm -v 2>/dev/null | cut -d. -f1)"
if [[ -n "$NPM_MAJOR" && "$NPM_MAJOR" -ge 10 ]]; then
  pass "npm v$(npm -v) (>= 10)"
else
  fail "npm major version is '${NPM_MAJOR:-not found}' (need >= 10)" "nvm install \$(cat .nvmrc) && nvm use"
fi

# ── Docker daemon reachable ──────────────────────────────────────────────────
DOCKER_OK=false
if docker info >/dev/null 2>&1; then
  DOCKER_OK=true
  pass "docker daemon is reachable"
else
  fail "docker daemon is not reachable" "start Docker Desktop / dockerd, then: docker info"
fi

# ── Postgres healthy ─────────────────────────────────────────────────────────
PG_HOST="${PEGASUS_PG_HOST:-}"
PG_PORT="${PEGASUS_PG_PORT:-}"
DB_OK=false
if [[ -n "$PG_HOST" || -n "$PG_PORT" ]]; then
  # Override path: plain TCP probe (lets the failure path be tested
  # without stopping the shared container).
  if (exec 3<>"/dev/tcp/${PG_HOST:-localhost}/${PG_PORT:-5432}") 2>/dev/null; then
    DB_OK=true
    pass "postgres is reachable at ${PG_HOST:-localhost}:${PG_PORT:-5432}"
  else
    fail "postgres is not reachable at ${PG_HOST:-localhost}:${PG_PORT:-5432}" "docker compose up -d postgres"
  fi
elif [[ "$DOCKER_OK" == true ]] && docker compose exec -T postgres pg_isready -U pegasus -d pegasus >/dev/null 2>&1; then
  DB_OK=true
  pass "postgres container is healthy (pg_isready)"
elif (exec 3<>"/dev/tcp/localhost/5432") 2>/dev/null; then
  # Postgres answering on the default port but not via this compose project
  # (e.g. started from another checkout/worktree, or outside compose).
  DB_OK=true
  pass "postgres is reachable at localhost:5432"
else
  fail "postgres is not running/healthy" "docker compose up -d postgres"
fi

# ── .env files present ───────────────────────────────────────────────────────
for envfile in apps/api/.env apps/tenant-web/.env apps/admin-web/.env; do
  if [[ -f "$envfile" ]]; then
    pass "$envfile exists"
  else
    fail "$envfile is missing" "npm run setup"
  fi
done

# ── SPA runtime config.json present ──────────────────────────────────────────
for cfg in apps/tenant-web/public/config.json apps/admin-web/public/config.json; do
  if [[ -f "$cfg" ]]; then
    pass "$cfg exists"
  else
    fail "$cfg is missing" "npm run setup"
  fi
done

# ── DATABASE_URL active in apps/api/.env ─────────────────────────────────────
if [[ -f apps/api/.env ]] && grep -q '^DATABASE_URL=' apps/api/.env; then
  pass "DATABASE_URL is set (uncommented) in apps/api/.env"
else
  fail "DATABASE_URL is missing or commented out in apps/api/.env" "npm run setup  (or uncomment DATABASE_URL in apps/api/.env)"
fi

# ── Prisma client generated ──────────────────────────────────────────────────
if [[ -d node_modules/.prisma/client || -d apps/api/node_modules/.prisma/client ]]; then
  pass "Prisma client is generated"
else
  fail "Prisma client has not been generated" "cd apps/api && npx prisma generate"
fi

# ── Migrations up to date (WARN when no DB to ask) ───────────────────────────
if [[ "$DB_OK" == true ]]; then
  if (cd apps/api && npx prisma migrate status >/dev/null 2>&1); then
    pass "database schema is up to date (prisma migrate status)"
  else
    fail "database has pending migrations (or migrate status errored)" "cd apps/api && npx prisma migrate deploy"
  fi
else
  warn "skipping migration status — database is not reachable"
fi

# ── turbo / esbuild binaries executable (WSL2 mounts) ────────────────────────
BIN_PROBLEM=""
for bin in node_modules/turbo-linux-64/bin/turbo node_modules/@esbuild/linux-x64/bin/esbuild; do
  if [[ -f "$bin" && ! -x "$bin" ]]; then
    BIN_PROBLEM="$bin"
  fi
done
if [[ -z "$BIN_PROBLEM" ]]; then
  pass "turbo/esbuild binaries are executable"
else
  fail "$BIN_PROBLEM is not executable" "npm run setup  (or: chmod +x $BIN_PROBLEM)"
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}✔ All checks passed.${RESET}\n"
  exit 0
else
  echo -e "${RED}${BOLD}✘ $FAILURES check(s) failed.${RESET}  Run the printed fix commands, then re-run: npm run doctor\n"
  exit 1
fi
