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

comment_out_default_db_url() {
  local envfile="$1"
  if [[ -f "$envfile" ]] && grep -q '^DATABASE_URL="postgresql://pegasus:pegasus' "$envfile" 2>/dev/null; then
    sed -i 's/^DATABASE_URL=/#DATABASE_URL=/' "$envfile"
    sed -i 's/^DIRECT_URL=/#DIRECT_URL=/' "$envfile"
    info "Commented out default DATABASE_URL in $envfile — uncomment after starting Docker or configuring Neon"
  fi
}

echo -e "${BOLD}Environment files${RESET}"
# Support both pre- and post-restructure layouts
for api_dir in apps/api packages/api; do
  [[ -d "$api_dir" ]] && copy_if_missing "$api_dir/.env.example" "$api_dir/.env" && comment_out_default_db_url "$api_dir/.env"
done
for web_dir in apps/tenant-web packages/web; do
  [[ -d "$web_dir" ]] && copy_if_missing "$web_dir/.env.example" "$web_dir/.env"
done
for admin_dir in apps/admin-web apps/admin; do
  [[ -d "$admin_dir" ]] && copy_if_missing "$admin_dir/.env.example" "$admin_dir/.env"
done

# ── 2. Copy runtime config.json templates ────────────────────────────────────

echo -e "\n${BOLD}SPA runtime config${RESET}"
for web_dir in apps/tenant-web packages/web; do
  [[ -f "$web_dir/public/config.json.example" ]] && copy_if_missing "$web_dir/public/config.json.example" "$web_dir/public/config.json"
done
for admin_dir in apps/admin-web apps/admin; do
  [[ -f "$admin_dir/public/config.json.example" ]] && copy_if_missing "$admin_dir/public/config.json.example" "$admin_dir/public/config.json"
done

# ── 3. Generate Prisma client ────────────────────────────────────────────────

echo -e "\n${BOLD}Prisma client${RESET}"
for api_dir in apps/api packages/api; do
  if [[ -f "$api_dir/prisma/schema.prisma" ]]; then
    (cd "$api_dir" && npx prisma generate --no-hints 2>/dev/null)
    ok "Prisma client generated from $api_dir"
    break
  fi
done

# ── 4. Fix binary permissions (WSL2 / restrictive mounts) ───────────────────

echo -e "\n${BOLD}Binary permissions${RESET}"
chmod +x node_modules/turbo-linux-64/bin/turbo        2>/dev/null || true
chmod +x node_modules/@esbuild/linux-x64/bin/esbuild  2>/dev/null || true
find node_modules/.bin -type f -exec chmod +x {} +    2>/dev/null || true
ok "node_modules binaries are executable"

# ── Done ─────────────────────────────────────────────────────────────────────

echo -e "\n${GREEN}${BOLD}✔ Setup complete.${RESET}"
echo -e "  Edit your API ${BOLD}.env${RESET} with your Neon connection strings before starting the API."
echo -e "  Then run: ${BOLD}npm run dev${RESET}\n"
