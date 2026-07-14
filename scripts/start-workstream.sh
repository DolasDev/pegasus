#!/usr/bin/env bash
# =============================================================================
# start-workstream.sh — Provision an isolated worktree for an approved plan and
#                       seed the plan into it, ready to implement.
#
# Usage: scripts/start-workstream.sh [<type>] <slug> <plan-file>
#          <type>       Branch prefix: feat | fix | chore | docs  (default: feat)
#          <slug>       Short lowercase id, same convention as new-worktree.sh
#          <plan-file>  Path to the drafted, user-approved plan (e.g. a plan-mode
#                       artifact under ~/.claude/plans/) to seed the worktree with
#
# Flow (see .claude/commands/start-workstream.md for the session-level wrapper):
#   1. Delegates worktree + branch + isolated Postgres + env provisioning to
#      scripts/new-worktree.sh <type> <slug> (idempotent, reused unchanged).
#   2. Copies <plan-file> into <worktree>/plans/in-progress/<slug>.md — inside
#      the worktree ONLY; the primary checkout (main) is never touched.
#   3. Prints the worktree path and stops. The caller moves the session into the
#      worktree (EnterWorktree) and implements there. The plan file is committed
#      TOGETHER with the implementation and lands on main via the branch's single
#      PR when the work is done.
#
# Deliberately side-effect-free on the remote: this script performs NO git
# commit / push / PR / auto-merge. It only provisions a worktree and drops a
# file into it, so it is safe to re-run and never races the merge queue. (The
# earlier version landed the plan on main via its own auto-merged PR; that was
# dropped because editing the plan mid-implementation — which the workflow
# expects — made the branch's later PR conflict with itself on the plan file,
# and it added avoidable main-push churn.)
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'
BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${BLUE}ℹ${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
fail() { echo -e "${RED}✘${RESET}  $*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "\n${BOLD}Pegasus — Start Workstream${RESET}\n"

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
  echo -e "  <plan-file>  path to the drafted plan markdown to seed the worktree with" >&2
  exit 1
fi
TYPE="${TYPE:-feat}"

if ! [[ "$TYPE" =~ ^(feat|fix|chore|docs)$ ]]; then
  fail "Invalid type '$TYPE'. Must be one of: feat | fix | chore | docs"
fi
if ! [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  fail "Invalid slug '$SLUG'. Must match: [a-z0-9][a-z0-9-]* (lowercase letters, digits, hyphens; no leading hyphen)"
fi
[[ -f "$PLAN_FILE" ]] || fail "Plan file not found: $PLAN_FILE"

WORKTREE_PATH="$(dirname "$REPO_ROOT")/pegasus-${SLUG}"
BRANCH_NAME="${TYPE}/${SLUG}"
PLAN_DEST_REL="plans/in-progress/${SLUG}.md"

# ── Step 1: provision the worktree (idempotent, delegated) ───────────────────

echo -e "${BOLD}Worktree provisioning${RESET}"
info "Delegating to scripts/new-worktree.sh ${TYPE} ${SLUG}..."
# </dev/null keeps new-worktree.sh non-interactive (it drops into a shell on a
# tty otherwise) so this script stays scriptable.
"$REPO_ROOT/scripts/new-worktree.sh" "$TYPE" "$SLUG" </dev/null
ok "Worktree ready: $WORKTREE_PATH (branch $BRANCH_NAME)"

[[ -d "$WORKTREE_PATH" ]] || fail "Expected worktree at $WORKTREE_PATH but it does not exist."

# ── Step 2: seed the plan into the worktree (never the primary checkout) ─────

echo -e "\n${BOLD}Seeding the plan${RESET}"
DEST="$WORKTREE_PATH/$PLAN_DEST_REL"
if [[ -f "$DEST" ]]; then
  warn "Plan already present at $PLAN_DEST_REL — leaving it as-is (re-run is idempotent; will not clobber an edited plan)."
else
  mkdir -p "$(dirname "$DEST")"
  cp "$PLAN_FILE" "$DEST"
  ok "Seeded $PLAN_DEST_REL from $PLAN_FILE"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}✔ Workstream ready.${RESET}"
echo ""
echo -e "  ${BOLD}Worktree:${RESET}   $WORKTREE_PATH"
echo -e "  ${BOLD}Branch:${RESET}     $BRANCH_NAME  (based on origin/main)"
echo -e "  ${BOLD}Plan:${RESET}       $PLAN_DEST_REL  (uncommitted — commit it with your implementation)"
echo ""
echo -e "  ${BOLD}Next:${RESET} move the session into the worktree and implement there."
echo -e "        The start-workstream skill calls EnterWorktree for you; manually:"
echo -e "          cd $WORKTREE_PATH"
echo -e "        Commit the plan + code together and open ONE PR when the work is done."
echo ""
