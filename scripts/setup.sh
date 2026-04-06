#!/usr/bin/env bash
# =============================================================================
# setup.sh — Post-install local development setup
# Run once after `npm install`, safe to re-run at any time.
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

echo -e "${BOLD}Environment files${RESET}"
copy_if_missing packages/api/.env.example   packages/api/.env
copy_if_missing packages/web/.env.example   packages/web/.env
copy_if_missing apps/admin/.env.example     apps/admin/.env

# Comment out DATABASE_URL/DIRECT_URL so tests skip DB-dependent suites
# until the developer configures a real database (Docker or Neon).
if [[ -f packages/api/.env ]]; then
  if grep -q '^DATABASE_URL="postgresql://pegasus:pegasus' packages/api/.env 2>/dev/null; then
    sed -i 's/^DATABASE_URL=/#DATABASE_URL=/' packages/api/.env
    sed -i 's/^DIRECT_URL=/#DIRECT_URL=/' packages/api/.env
    info "Commented out default DATABASE_URL — uncomment after starting Docker or configuring Neon"
  fi
fi

# ── 2. Copy runtime config.json templates ────────────────────────────────────

echo -e "\n${BOLD}SPA runtime config${RESET}"
copy_if_missing packages/web/public/config.json.example  packages/web/public/config.json
copy_if_missing apps/admin/public/config.json.example    apps/admin/public/config.json

# ── 3. Generate Prisma client ────────────────────────────────────────────────

echo -e "\n${BOLD}Prisma client${RESET}"
(cd packages/api && npx prisma generate --no-hints 2>/dev/null)
ok "Prisma client generated"

# ── 4. Fix binary permissions (WSL2 / restrictive mounts) ───────────────────

echo -e "\n${BOLD}Binary permissions${RESET}"
chmod +x node_modules/turbo-linux-64/bin/turbo        2>/dev/null || true
chmod +x node_modules/@esbuild/linux-x64/bin/esbuild  2>/dev/null || true
find node_modules/.bin -type f -exec chmod +x {} +    2>/dev/null || true
ok "node_modules binaries are executable"

# ── Done ─────────────────────────────────────────────────────────────────────

echo -e "\n${GREEN}${BOLD}✔ Setup complete.${RESET}"
echo -e "  Edit ${BOLD}packages/api/.env${RESET} with your Neon connection strings before starting the API."
echo -e "  Then run: ${BOLD}npm run dev${RESET}\n"
