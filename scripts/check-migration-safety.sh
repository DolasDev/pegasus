#!/usr/bin/env bash
#
# Expand-contract migration guard. Fails when a newly-added Prisma migration
# contains destructive DDL without an explicit sign-off marker, enforcing the
# policy in dolas/agents/project/PATTERNS.md ("Destructive DDL is contract-only
# and gated"). See docs/runbooks/rollback.md for why rollbacks stay code-only.
#
# Usage: scripts/check-migration-safety.sh [base-ref]   (default: origin/main)
# Exits 0 when clean, 1 when a destructive migration lacks the marker.
#
# Marker (added intentionally, only once the old-shape readers are gone):
#   -- expand-contract: contract approved
set -euo pipefail

base="${1:-origin/main}"

# Directory pathspec (not a `**` glob — git pathspec wildcards don't reliably
# cross `/`, which would silently match nothing and turn the guard false-green).
# Filter to migration.sql files in the loop instead.
added=$(git diff --diff-filter=A --name-only "$base"...HEAD -- 'apps/api/prisma/migrations/' \
  | { grep -E '/migration\.sql$' || true; })

[ -z "$added" ] && { echo "No new migrations versus $base — nothing to check."; exit 0; }

fail=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if grep -qiE 'DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|ALTER[[:space:]]+TABLE[[:space:]].*RENAME|SET[[:space:]]+NOT[[:space:]]+NULL' "$f" \
     && ! grep -q -- '-- expand-contract: contract approved' "$f"; then
    echo "::error file=$f::Destructive DDL without the '-- expand-contract: contract approved' marker. See dolas/agents/project/PATTERNS.md and docs/runbooks/rollback.md."
    fail=1
  else
    echo "OK: $f"
  fi
done <<< "$added"

exit $fail
