"""Pegasus Temporal worker — runtime that executes curated stdlib workflows.

Phase 2 Unit 5. The worker connects to Temporal Cloud, registers only the
workflows listed in :mod:`pegasus_temporal_worker.registry` (curated-only
boundary), polls a single task queue per env, and writes terminal status
back to the Pegasus API via the internal broker.
"""

from __future__ import annotations

__all__: list[str] = []
