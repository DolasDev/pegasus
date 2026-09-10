#!/usr/bin/env python3
"""CI config guard: a path-filtered job must also run in the merge queue.

WHY THIS EXISTS
---------------
A *skipped* required status check SATISFIES branch protection — by design; it is
what lets a docs-only PR merge without running the heavy jobs. Combine that with
how ci.yml gates its jobs and you get a silent hole:

  1. Jobs are gated on dorny/paths-filter output (``needs.changes.outputs.*``).
  2. paths-filter has no meaningful base to diff a ``merge_group`` ref against,
     so those outputs are not trustworthy there.
  3. A job gated ONLY on the filter therefore skips inside the merge queue.
  4. Its required check then passes VACUOUSLY.

The result is a check that gates a PR but never re-verifies the merged result —
precisely the case a merge queue exists to catch, where two PRs are each green
alone and broken together. The fix is one clause::

    if: needs.changes.outputs.foo == 'true' || github.event_name == 'merge_group'

which keeps the job path-filtered on PRs and unconditional in the queue.

This was a convention held only by a comment. Conventions decay; the rule is
mechanically checkable, so it is checked here instead.

THE RULES
---------
1. Every job whose ``if:`` reads ``needs.changes.outputs.*`` must also allow
   ``github.event_name == 'merge_group'``.
2. Every ``needs.changes.outputs.X`` referenced must actually be declared as an
   output of the ``changes`` job. A typo'd name is always falsy, so the job NEVER
   runs — and if it is a required check, it skips forever and passes vacuously on
   every PR. Same class of bug, even quieter.

Rule 1 is enforced for ALL path-filtered jobs, not only those required today, so
promoting any job to a required check is safe by construction. If a job ever
genuinely should skip in the queue, add it to ALLOWED_QUEUE_SKIPS with a reason.

Python + PyYAML rather than Node deliberately: the Node route needs a YAML
parser as a root dependency, and the obvious one (``yaml``) collides with the
security override in package.json, while adding ``js-yaml`` re-hoists it across
the whole tree. A dev-only guard should not perturb the dependency graph.
PyYAML ships with the runner image and needs no lockfile change.

Usage: python3 scripts/check_ci_merge_group.py [path/to/ci.yml]
Exit 0 = clean, 1 = violation (fails the build).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError:  # pragma: no cover - environment problem, not a rule violation
    sys.exit(
        "✖ PyYAML is required by this guard but is not importable.\n"
        "  It ships with the GitHub runner image; locally run: pip install pyyaml"
    )

#: Jobs deliberately allowed to skip inside the merge queue: {job key: reason}.
#:
#: Empty on purpose. A job belongs here only if it is NOT a required status check
#: AND is expensive enough that running it per merge-group is not worth it. An
#: entry means "this job's result is never verified against the merged result" —
#: so pair it with a reason, and never add a required check.
ALLOWED_QUEUE_SKIPS: dict[str, str] = {}

FILTER_REF = re.compile(r"needs\s*\.\s*changes\s*\.\s*outputs\s*\.\s*([A-Za-z0-9_]+)")
MERGE_GROUP = re.compile(r"github\s*\.\s*event_name\s*==\s*['\"]merge_group['\"]")

DEFAULT_WORKFLOW = Path(__file__).resolve().parent.parent / ".github/workflows/ci.yml"


def main(argv: list[str]) -> int:
    workflow_path = Path(argv[1]) if len(argv) > 1 else DEFAULT_WORKFLOW
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))

    jobs = (workflow or {}).get("jobs")
    if not isinstance(jobs, dict):
        print(f"✖ {workflow_path}: no `jobs:` map found — is this a workflow file?")
        return 1

    declared = list((jobs.get("changes") or {}).get("outputs") or {})
    if not declared:
        print("✖ the `changes` job declares no outputs — cannot validate filter references.")
        return 1

    missing_clause: list[str] = []
    unknown_outputs: list[str] = []
    path_filtered = 0

    for key, job in jobs.items():
        condition = (job or {}).get("if")
        if not isinstance(condition, str):
            continue

        referenced = FILTER_REF.findall(condition)
        if not referenced:
            continue

        path_filtered += 1
        name = (job or {}).get("name")
        label = f'{key} ("{name}")' if name else key

        for output in referenced:
            if output not in declared:
                unknown_outputs.append(
                    f"  {label}\n"
                    f"      reads needs.changes.outputs.{output}, which the `changes` job"
                    f" does not declare.\n"
                    f"      Declared: {', '.join(declared)}"
                )

        if MERGE_GROUP.search(condition):
            continue

        if key in ALLOWED_QUEUE_SKIPS:
            print(f"• {label} skips the queue by exemption: {ALLOWED_QUEUE_SKIPS[key]}")
            continue

        missing_clause.append(f"  {label}\n      if: {condition}")

    if not unknown_outputs and not missing_clause:
        print(
            f"✔ ci.yml merge-queue guard: {path_filtered} path-filtered job(s)"
            " all run in the merge queue."
        )
        return 0

    if unknown_outputs:
        print("\n✖ Unknown paths-filter output referenced\n")
        print("\n\n".join(unknown_outputs))
        print(
            "\n  An undeclared output is always falsy, so the job never runs. If it is a"
            "\n  required check, it skips forever and passes vacuously on every PR.\n"
        )

    if missing_clause:
        print("\n✖ Path-filtered job(s) missing the merge_group clause\n")
        print("\n\n".join(missing_clause))
        print(
            "\n  Append `|| github.event_name == 'merge_group'` to each `if:` above."
            "\n\n  Without it the job SKIPS inside the merge queue, and a skipped required"
            "\n  check satisfies branch protection — so it would gate the PR but never"
            "\n  re-verify the merged result."
            "\n\n  If a job genuinely should skip in the queue, add it to"
            "\n  ALLOWED_QUEUE_SKIPS in this script with a reason (it must not be a"
            "\n  required status check).\n"
        )

    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
