#!/usr/bin/env bash
# Run the npm dependency-security gate (audit-ci, config in audit-ci.jsonc).
#
# Shared by the `Lint` job in ci.yml (the gate on every PR and merge-queue run)
# and dependency-audit.yml (the daily run on main), so the two cannot drift.
#
# npm's advisory endpoint intermittently returns malformed responses that
# break `npm audit`; audit-ci surfaces this as "code undefined: Exiting..."
# with no advisories listed and exits 1, which stalled the entire merge
# queue on 2026-07-26. Pass ONLY on that endpoint-error signature — real
# high/critical advisories print their GHSA ids, never "code undefined", so
# they still fail the gate. (`pass-enoaudit` in audit-ci.jsonc covers the
# separate offline / missing-lockfile case.)
#
# Output goes to stdout either way; exit status is the verdict.
set -uo pipefail

if out=$(npx --no-install audit-ci --config ./audit-ci.jsonc 2>&1); then
  echo "$out"
  exit 0
fi

echo "$out"
if printf '%s' "$out" | grep -q 'code undefined'; then
  echo "::warning::audit-ci could not complete (npm advisory endpoint error) — passing; real advisories still block. Re-run once npm recovers."
  exit 0
fi
exit 1
