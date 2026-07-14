#!/usr/bin/env bash
# =============================================================================
# start-workstream.sh — Provision a worktree for a new plan, land the plan
#                        file on `main` immediately (via its own PR), then
#                        hand back the worktree path to continue implementing.
#
# Usage: scripts/start-workstream.sh [<type>] <slug> <plan-file>
#          <type>       Branch prefix: feat | fix | chore | docs  (default: feat)
#          <slug>       Short lowercase id, same convention as new-worktree.sh
#          <plan-file>  Path to the drafted plan (e.g. a plan-mode artifact
#                       under ~/.claude/plans/) to move into the worktree
#
# What this does (see .claude/commands/start-workstream.md for the full flow
# this is one step of):
#   1. Delegates worktree + branch + isolated Postgres + env provisioning to
#      scripts/new-worktree.sh <type> <slug> (idempotent, reused as-is).
#   2. Copies <plan-file> into <worktree>/plans/in-progress/<slug>.md — this
#      is the ONLY place the plan is ever written; the primary checkout (main)
#      is never touched, so main stays clean per Branch Discipline.
#   3. Commits + pushes just that one file on the new branch, opens a PR, and
#      enables auto-merge — so the plan reaches `main` through the normal
#      queue (never a direct push) and becomes visible to every other
#      worktree/branch created from main afterward.
#   4. Prints the worktree path. The caller (the start-workstream skill) is
#      expected to move the session into it (EnterWorktree) and continue
#      implementing on the same branch — later commits land via the branch's
#      own PR when the work is done.
#
# Known trade-off: because the plan-file PR gets squash-merged into `main`
# ahead of the rest of the branch's history, a later PR for the same branch
# will show plans/in-progress/<slug>.md in its diff again (content-identical,
# so it merges cleanly — just a cosmetic double-listing on the PR page).
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'
BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${BLUE}ℹ${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
fail() { echo -e "${RED}✘${RESET}  $*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "\n${BOLD}Pegasus — Start Workstream (plan-first)${RESET}\n"

# ── Parse args (mirrors new-worktree.sh's own convention) ────────────────────
TYPE=""
SLUG=""
PLAN_FILE=""
if [[ $# -eq 3 ]]; then
  TYPE="$1"; SLUG="$2"; PLAN_FILE="$3"
elif [[ $# -eq 2 ]]; then
  SLUG="$1"; PLAN_FILE="$2"
else
  echo -e "Usage: $(basename "$0") [<type>] <slug> <plan-file>" >&2
  echo -e "  <type>       feat | fix | chore | docs  (default: feat)" >&2
  echo -e "  <slug>       lowercase-hyphen id, e.g. rating-engine" >&2
  echo -e "  <plan-file>  path to the drafted plan markdown to land" >&2
  exit 1
fi
TYPE="${TYPE:-feat}"

if ! [[ "$TYPE" =~ ^(feat|fix|chore|docs)$ ]]; then
  fail "Invalid type '$TYPE'. Must be one of: feat | fix | chore | docs"
fi
if ! [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  fail "Invalid slug '$SLUG'. Must match: [a-z0-9][a-z0-9-]*"
fi
[[ -f "$PLAN_FILE" ]] || fail "Plan file not found: $PLAN_FILE"

WORKTREE_PATH="$(dirname "$REPO_ROOT")/pegasus-${SLUG}"
BRANCH_NAME="${TYPE}/${SLUG}"
PLAN_DEST_REL="plans/in-progress/${SLUG}.md"

# ── Step 1: provision the worktree (idempotent, delegated) ───────────────────

echo -e "${BOLD}Worktree provisioning${RESET}"
info "Delegating to scripts/new-worktree.sh ${TYPE} ${SLUG}..."
"$REPO_ROOT/scripts/new-worktree.sh" "$TYPE" "$SLUG" </dev/null
ok "Worktree ready: $WORKTREE_PATH (branch $BRANCH_NAME)"

[[ -d "$WORKTREE_PATH" ]] || fail "Expected worktree at $WORKTREE_PATH but it does not exist."

# ── Step 2: land the plan file into the worktree only ────────────────────────

echo -e "\n${BOLD}Landing the plan${RESET}"
DEST="$WORKTREE_PATH/$PLAN_DEST_REL"
if [[ -f "$DEST" ]]; then
  warn "Plan already present at $PLAN_DEST_REL — leaving it as-is (re-run is idempotent)."
else
  mkdir -p "$(dirname "$DEST")"
  cp "$PLAN_FILE" "$DEST"
  ok "Copied $PLAN_FILE -> $WORKTREE_PATH/$PLAN_DEST_REL"
fi

# ── Step 3: commit + push + PR + auto-merge, all inside the new worktree ─────

echo -e "\n${BOLD}Commit + push${RESET}"
if [[ -n "$(git -C "$WORKTREE_PATH" status --porcelain -- "$PLAN_DEST_REL")" ]]; then
  git -C "$WORKTREE_PATH" add "$PLAN_DEST_REL"
  git -C "$WORKTREE_PATH" commit -m "plan: ${SLUG}" >/dev/null
  ok "Committed $PLAN_DEST_REL"
else
  ok "Plan file already committed — nothing to commit (idempotent re-run)"
fi

info "Pushing $BRANCH_NAME..."
git -C "$WORKTREE_PATH" push -u origin "$BRANCH_NAME"
ok "Pushed"

echo -e "\n${BOLD}Pull request${RESET}"
if command -v gh &>/dev/null; then
  if gh pr view "$BRANCH_NAME" &>/dev/null; then
    ok "PR for $BRANCH_NAME already exists — reusing"
  else
    gh pr create --head "$BRANCH_NAME" --base main \
      --title "plan: ${SLUG}" \
      --body "$(cat <<EOF
Lands the plan for \`${SLUG}\` on \`main\` first so other in-flight worktrees
can see it in \`plans/in-progress/\`. Implementation follows in this same
branch/worktree; this PR only carries the plan file.
EOF
)" >/dev/null
    ok "PR opened for $BRANCH_NAME"
  fi
  info "Enabling auto-merge (squash) so the plan reaches main via the normal queue..."
  gh pr merge "$BRANCH_NAME" --auto --squash || warn "Could not enable auto-merge — enable manually: gh pr merge $BRANCH_NAME --auto --squash"
else
  warn "gh CLI not found — push succeeded, but open the PR manually: gh pr create --head $BRANCH_NAME --base main"
fi

# ── Summary ────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}✔ Workstream started.${RESET}"
echo ""
echo -e "  ${BOLD}Worktree:${RESET}   $WORKTREE_PATH"
echo -e "  ${BOLD}Branch:${RESET}     $BRANCH_NAME"
echo -e "  ${BOLD}Plan:${RESET}       $PLAN_DEST_REL (queued to merge into main)"
echo ""
echo -e "  Continue the session in this worktree, e.g.:"
echo -e "    cd $WORKTREE_PATH"
echo ""
