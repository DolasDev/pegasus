#!/usr/bin/env bash

if [ -z "$1" ]; then
  echo "Usage: ./scripts/remove_agent.sh <feature-name>"
  exit 1
fi

FEATURE_NAME="$1"
BRANCH_NAME="feature/${FEATURE_NAME}"
TARGET_DIR="worktrees/${FEATURE_NAME}"

echo "Removing worktree..."
git worktree remove ${TARGET_DIR}

echo "Deleting branch..."
git branch -D ${BRANCH_NAME}

echo "Done."