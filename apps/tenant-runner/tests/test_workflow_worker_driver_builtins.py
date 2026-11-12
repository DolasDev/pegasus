"""The worker driver registers the SDK's built-in activities (run_automation, SDK 0.65.0+)."""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest
from temporalio import activity

from pegasus_tenant_runner import workflow_worker_driver as driver

SDK_SRC = Path(__file__).resolve().parents[3] / "packages" / "workflows-sdk-python"


@activity.defn
async def notify() -> str:
    return "tenant"


@activity.defn(name="pegasus.run_automation")
async def tenant_shadow() -> str:
    return "tenant shadow"


@activity.defn(name="pegasus.run_automation")
async def builtin_run_automation() -> str:
    return "builtin"


def _names(activities: list) -> list[str]:
    return [a.__temporal_activity_definition.name for a in activities]


def test_builtins_are_added_once_and_win_a_name_clash() -> None:
    merged = driver.with_builtin_activities([notify, tenant_shadow], [builtin_run_automation])
    assert sorted(_names(merged)) == ["notify", "pegasus.run_automation"]
    assert builtin_run_automation in merged
    assert tenant_shadow not in merged


def test_no_builtins_leaves_the_tenant_activities_alone() -> None:
    assert driver.with_builtin_activities([notify], []) == [notify]


def test_an_sdk_without_steps_adds_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    # An SDK older than 0.65.0: the package exists, the steps module doesn't.
    monkeypatch.setitem(sys.modules, "pegasus_workflows", types.ModuleType("pegasus_workflows"))
    monkeypatch.delitem(sys.modules, "pegasus_workflows.steps", raising=False)
    assert driver.builtin_activities() == []


def test_the_sdk_steps_module_provides_run_automation(monkeypatch: pytest.MonkeyPatch) -> None:
    if not (SDK_SRC / "pegasus_workflows" / "steps.py").exists():  # pragma: no cover
        pytest.skip("SDK source not next to the runner")
    for name in [m for m in sys.modules if m.startswith("pegasus_workflows")]:
        monkeypatch.delitem(sys.modules, name)
    monkeypatch.syspath_prepend(str(SDK_SRC))
    assert _names(driver.builtin_activities()) == ["pegasus.run_automation"]
