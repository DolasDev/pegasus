#!/usr/bin/env bash
# =============================================================================
# rm-worktree.sh — Tear down an isolated git worktree + Postgres container
#                  created by scripts/new-worktree.sh.
#
# Usage: scripts/rm-worktree.sh <slug>
#
# Removes:
#   pegasus-pg-<slug>    — Docker container (stopped + deleted)
#   ../pegasus-<slug>    — git worktree (removed + pruned)
#   <type>/<slug>        — the branch actually attached to the worktree (deleted if not current)
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

echo -e "\n${BOLD}Pegasus — Worktree Teardown${RESET}\n"

# ── Validate slug arg ────────────────────────────────────────────────────────

SLUG="${1:-}"
if [[ -z "$SLUG" ]]; then
  echo -e "Usage: $(basename "$0") <slug>" >&2
  echo -e "  <slug>  The same slug used with new-worktree.sh" >&2
  exit 1
fi

if ! [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  fail "Invalid slug '$SLUG'. Must match: [a-z0-9][a-z0-9-]* (lowercase letters, digits, hyphens; no leading hyphen)"
fi

WORKTREE_PATH="$(dirname "$REPO_ROOT")/pegasus-${SLUG}"
CONTAINER_NAME="pegasus-pg-${SLUG}"

# Resolve the branch actually attached to this worktree (it is <type>/<slug>,
# not necessarily == slug). Must happen BEFORE the worktree is removed below.
BRANCH_NAME="$(git -C "$REPO_ROOT" worktree list --porcelain \
  | awk -v wt="worktree $WORKTREE_PATH" '
      $0 == wt { found=1; next }
      found && /^branch / { sub("refs/heads/", "", $2); print $2; exit }
      found && /^worktree / { exit }
    ')"
# Fall back to the bare slug if the worktree is not registered (already gone).
[[ -z "$BRANCH_NAME" ]] && BRANCH_NAME="$SLUG"

# ── Stop + remove Docker container ───────────────────────────────────────────

echo -e "${BOLD}Docker container${RESET}"
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  info "Removing container $CONTAINER_NAME..."
  docker rm -f "$CONTAINER_NAME" >/dev/null
  ok "Container $CONTAINER_NAME removed"
else
  ok "Container $CONTAINER_NAME not found — nothing to remove"
fi

# ── Remove git worktree ───────────────────────────────────────────────────────

echo -e "\n${BOLD}Git worktree${RESET}"

if git -C "$REPO_ROOT" worktree list --porcelain | grep -qF "worktree $WORKTREE_PATH"; then
  # Check if the worktree has uncommitted changes
  if [[ -d "$WORKTREE_PATH" ]]; then
    DIRTY_FILES="$(git -C "$WORKTREE_PATH" status --porcelain 2>/dev/null || echo '')"
    if [[ -n "$DIRTY_FILES" ]]; then
      warn "Worktree $WORKTREE_PATH has uncommitted changes:"
      echo "$DIRTY_FILES" | head -20 | while IFS= read -r line; do
        echo "    $line"
      done
      warn "Removing anyway (use 'git -C $WORKTREE_PATH stash' to save work first)."
    fi
  fi
  info "Removing worktree $WORKTREE_PATH..."
  if git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_PATH" 2>&1; then
    ok "Worktree $WORKTREE_PATH removed"
  else
    warn "git worktree remove failed — the git ref will be pruned but the directory may persist"
    warn "Manual cleanup if needed: rm -rf $WORKTREE_PATH"
  fi
else
  ok "Worktree $WORKTREE_PATH not registered — nothing to remove"
  # Still try to remove the directory if it exists
  if [[ -d "$WORKTREE_PATH" ]]; then
    warn "Directory $WORKTREE_PATH exists but is not a registered worktree — removing manually..."
    rm -rf "$WORKTREE_PATH"
    ok "Directory removed"
  fi
fi

info "Pruning stale worktree references..."
git -C "$REPO_ROOT" worktree prune
ok "Worktree refs pruned"

# ── Delete local branch ───────────────────────────────────────────────────────

echo -e "\n${BOLD}Branch${RESET}"

# Do not delete if it is the current branch
CURRENT_BRANCH="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo '')"
if [[ "$CURRENT_BRANCH" == "$BRANCH_NAME" ]]; then
  warn "Branch '$BRANCH_NAME' is the current branch in $REPO_ROOT — skipping deletion"
  warn "Switch to another branch first, then: git branch -D $BRANCH_NAME"
elif git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  info "Deleting local branch $BRANCH_NAME..."
  git -C "$REPO_ROOT" branch -D "$BRANCH_NAME"
  ok "Branch $BRANCH_NAME deleted"
else
  ok "Branch $BRANCH_NAME not found locally — nothing to delete"
fi

# ── Verify primary checkout is untouched ─────────────────────────────────────

echo -e "\n${BOLD}Verification${RESET}"
info "Primary checkout: $REPO_ROOT"
info "  Current branch: $(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo 'unknown')"
info "  Working tree:   $(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ') modified file(s)"

REMAINING_WORKTREES="$(git -C "$REPO_ROOT" worktree list 2>/dev/null)"
info "Remaining worktrees:"
echo "$REMAINING_WORKTREES" | while IFS= read -r line; do
  echo "    $line"
done

# Confirm the probe path is gone
if [[ -d "$WORKTREE_PATH" ]]; then
  warn "Directory $WORKTREE_PATH still exists — you may need to remove it manually: rm -rf $WORKTREE_PATH"
else
  ok "$WORKTREE_PATH — cleaned up"
fi

echo ""
echo -e "${GREEN}${BOLD}✔ Teardown complete for slug '${SLUG}'.${RESET}"
echo ""
