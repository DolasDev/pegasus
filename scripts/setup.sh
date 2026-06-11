#!/usr/bin/env bash
# =============================================================================
# setup.sh — One-command local development bootstrap
# Run once after `npm install`, safe to re-run at any time.
#
# Steps: env templates → SPA config → Prisma client → binary permissions →
#        Docker postgres → migrations → seed. Docker-dependent steps degrade
#        gracefully (warn + skip) when no Docker daemon is reachable.
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${BLUE}ℹ${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }

# Resolve repo root (script may be called from any directory)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo -e "\n${BOLD}Pegasus — Local Development Setup${RESET}\n"

# ── 1. Copy .env templates ───────────────────────────────────────────────────

copy_if_missing() {
  local src="$1"
  local dest="$2"
  if [[ -f "$dest" ]]; then
    ok "$dest already exists"
  elif [[ -f "$src" ]]; then
    cp "$src" "$dest"
    ok "Created $dest from template"
  else
    warn "Template $src not found — skipping"
  fi
}

# The template ships with the local-docker DATABASE_URL active — that is the
# out-of-the-box default. Re-activate it if an older setup.sh commented it out.
uncomment_default_db_url() {
  local envfile="$1"
  if [[ -f "$envfile" ]] && grep -q '^#DATABASE_URL="postgresql://pegasus:pegasus' "$envfile"; then
    sed -i 's/^#DATABASE_URL="postgresql:\/\/pegasus:pegasus/DATABASE_URL="postgresql:\/\/pegasus:pegasus/' "$envfile"
    sed -i 's/^#DIRECT_URL="postgresql:\/\/pegasus:pegasus/DIRECT_URL="postgresql:\/\/pegasus:pegasus/' "$envfile"
    info "Re-activated local-docker DATABASE_URL in $envfile"
  fi
}

echo -e "${BOLD}Environment files${RESET}"
copy_if_missing "apps/api/.env.example" "apps/api/.env"
uncomment_default_db_url "apps/api/.env"
copy_if_missing "apps/tenant-web/.env.example" "apps/tenant-web/.env"
copy_if_missing "apps/admin-web/.env.example" "apps/admin-web/.env"
info "Using Neon instead of local Docker? Edit DATABASE_URL/DIRECT_URL in apps/api/.env"

# ── 2. Copy runtime config.json templates ────────────────────────────────────

echo -e "\n${BOLD}SPA runtime config${RESET}"
copy_if_missing "apps/tenant-web/public/config.json.example" "apps/tenant-web/public/config.json"
copy_if_missing "apps/admin-web/public/config.json.example" "apps/admin-web/public/config.json"

# ── 3. Generate Prisma client ────────────────────────────────────────────────

echo -e "\n${BOLD}Prisma client${RESET}"
(cd apps/api && npx prisma generate --no-hints 2>/dev/null)
ok "Prisma client generated from apps/api"

# ── 4. Fix binary permissions (WSL2 / restrictive mounts) ───────────────────

echo -e "\n${BOLD}Binary permissions${RESET}"
chmod +x node_modules/turbo-linux-64/bin/turbo        2>/dev/null || true
chmod +x node_modules/@esbuild/linux-x64/bin/esbuild  2>/dev/null || true
find node_modules/.bin -type f -exec chmod +x {} +    2>/dev/null || true
ok "node_modules binaries are executable"

# ── 5. Start Docker postgres, migrate, seed ──────────────────────────────────

echo -e "\n${BOLD}Database${RESET}"
DB_READY=false

# Reuse a postgres that is already listening (started earlier, or from another
# checkout/worktree) — same graceful behaviour as apps/api/vitest.global-setup.ts.
if (exec 3<>"/dev/tcp/localhost/5432") 2>/dev/null; then
  DB_READY=true
  ok "postgres already running on localhost:5432 — reusing"
elif docker info >/dev/null 2>&1; then
  docker compose up -d postgres >/dev/null
  ok "postgres container started (docker compose up -d postgres)"

  # Wait for readiness — mirrors the docker-compose.yml healthcheck
  # (pg_isready -U pegasus -d pegasus, 5s interval, 5 retries → poll 1s × 30).
  for _ in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U pegasus -d pegasus >/dev/null 2>&1; then
      DB_READY=true
      break
    fi
    sleep 1
  done
  if [[ "$DB_READY" == true ]]; then
    ok "postgres is accepting connections"
  else
    warn "postgres did not become ready in 30s — skipping migrations and seed"
    warn "Check the container: docker compose logs postgres"
  fi
else
  warn "Docker is not available — skipping postgres start, migrations, and seed"
  warn "Start Docker and re-run: npm run setup  (or point apps/api/.env at Neon and run migrate/seed manually)"
fi

if [[ "$DB_READY" == true ]]; then
  echo -e "\n${BOLD}Migrations${RESET}"
  (cd apps/api && npx prisma migrate deploy)
  ok "Migrations applied"

  echo -e "\n${BOLD}Seed data${RESET}"
  npm run db:seed --workspace=@pegasus/api
  ok "Seed data in place"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

if [[ "$DB_READY" == true ]]; then
  echo -e "\n${GREEN}${BOLD}✔ Stack ready.${RESET}"
  echo -e "  Run: ${BOLD}npm run dev${RESET}"
  echo -e "    API        → :3000 (set SKIP_AUTH=true + DEFAULT_TENANT_ID in apps/api/.env to use the seeded dev tenant)"
  echo -e "    tenant-web → :5173"
  echo -e "    admin-web  → :5174"
  echo -e "  Admin-user creation (scripts/create-admin-user.ts) is NOT needed for local dev — SKIP_AUTH covers it.\n"
else
  echo -e "\n${YELLOW}${BOLD}⚠ Setup finished without a database.${RESET}"
  echo -e "  Start Docker and re-run ${BOLD}npm run setup${RESET}, or configure Neon in apps/api/.env"
  echo -e "  then run: ${BOLD}cd apps/api && npx prisma migrate deploy && npm run db:seed${RESET}\n"
  exit 0
fi
