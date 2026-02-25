#!/usr/bin/env bash

set -e

# ---- Config ----
BASE_BRANCH="main"
WORKTREE_DIR="worktrees"
SPEC_PATH="CLAUDE.md"

# ---- Input ----
if [ -z "$1" ]; then
  echo "Usage: ./scripts/launch_agent.sh <feature-name>"
  exit 1
fi

FEATURE_NAME="$1"
BRANCH_NAME="feature/${FEATURE_NAME}"
TARGET_DIR="${WORKTREE_DIR}/${FEATURE_NAME}"

# ---- Safety Checks ----

if [ ! -f "$SPEC_PATH" ]; then
  echo "Error: Agent spec not found at $SPEC_PATH"
  exit 1
fi

if [ -d "$TARGET_DIR" ]; then
  echo "Error: Worktree directory already exists at $TARGET_DIR"
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
  echo "Error: Branch ${BRANCH_NAME} already exists"
  exit 1
fi

# ---- Sync Base Branch ----
echo "Syncing ${BASE_BRANCH}..."
git checkout ${BASE_BRANCH}
git pull origin ${BASE_BRANCH}

# ---- Create Worktree ----
echo "Creating worktree at ${TARGET_DIR}..."
mkdir -p ${WORKTREE_DIR}
git worktree add ${TARGET_DIR} -b ${BRANCH_NAME} ${BASE_BRANCH}

# ---- Inject Agent Spec ----
cp ${SPEC_PATH} ${TARGET_DIR}/CLAUDE.md

# ---- Launch Claude ----
echo "Launching Claude in ${TARGET_DIR}..."
cd ${TARGET_DIR}

echo ""
echo "===================================================="
echo "Branch: ${BRANCH_NAME}"
echo "Worktree: ${TARGET_DIR}"
echo "Spec: AGENT_SPEC.md"
echo "===================================================="

claude