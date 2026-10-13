#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["temporalio==1.33.0"]
# ///
"""Stage B, Step 2: guardrail probe for the per-env temporal provisioners.

plans/in-progress/tenant-temporal-namespaces.md, "Step 2". Proves the property
3b relies on: ONE env's provisioner cannot touch what the OTHER env's provisioner
created, nor the existing platform namespaces, and a tenant key minted in one env
is refused by the other env's namespaces.

Run:   uv run scripts/temporal/guardrail-probe.py            (full probe)
       uv run scripts/temporal/guardrail-probe.py --cleanup  (teardown only)

Needs AWS SSO for profiles dolas-pegasus-{staging,prod} (it reads both
provisioner keys from Secrets Manager). Re-run it whenever the provisioner
identities or their roles change. Results of the first passing run (2026-10-12)
are in plans/*/tenant-temporal-namespaces.md, Appendix B.

Talks to the Cloud Ops REST API exactly as the provisioner Lambda does
(saas-api.tmprl.cloud, temporal-cloud-api-version v0.23.0, Bearer key).

Cloud changes it makes (all removed at the end, also on failure):
  * namespaces pg-staging-000000000000 / pg-prod-000000000000 (1-day retention),
    each by its own env's provisioner;
  * a namespace-scoped Write service account on each, and a 1-day key for it.
It NEVER sends a delete (or any mutation that would succeed destructively) at
pegasus-staging / pegasus-prod: those are probed only with calls whose success
would be harmless and is cleaned up (create a scoped SA, grant access).

Keys: the provisioner keys are read from Secrets Manager into memory; the
throwaway tenant keys exist only in memory. Nothing is printed or written.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

BASE = "https://saas-api.tmprl.cloud"
API_VERSION = "v0.23.0"
ACCOUNT = "chgel"
REGION = "aws-us-east-1"
REGIONAL_EP = "us-east-1.aws.api.temporal.io:7233"
ENVS = ("staging", "prod")
PLATFORM_NS = {e: f"pegasus-{e}.{ACCOUNT}" for e in ENVS}
THROWAWAY = {e: f"pg-{e}-000000000000" for e in ENVS}


def other(e: str) -> str:
    return "prod" if e == "staging" else "staging"


def ns_id(e: str) -> str:
    return f"{THROWAWAY[e]}.{ACCOUNT}"


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

RESULTS: list[tuple[str, str, str]] = []  # (verdict, label, detail)
MADE: dict = {}  # env -> Made, for cleanup verification


def record(verdict: str, label: str, detail: str = "") -> None:
    RESULTS.append((verdict, label, detail))
    print(f"  [{verdict:<7}] {label}{('  — ' + detail) if detail else ''}", flush=True)


# ---------------------------------------------------------------------------
# Cloud Ops REST
# ---------------------------------------------------------------------------


def provisioner_key(e: str) -> str:
    out = subprocess.run(
        ["aws", "secretsmanager", "get-secret-value", "--profile", f"dolas-pegasus-{e}",
         "--region", "us-east-1", "--secret-id", f"pegasus/{e}/temporal-provisioner",
         "--query", "SecretString", "--output", "text"],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)["apiKey"]


def ops(key: str | None, method: str, path: str, body: dict | None = None,
        query: dict | None = None) -> tuple[int, dict]:
    url = BASE + path + ("?" + urllib.parse.urlencode(query) if query else "")
    headers = {"temporal-cloud-api-version": API_VERSION}
    if key:
        headers["authorization"] = f"Bearer {key}"
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text else {})
    except urllib.error.HTTPError as err:
        text = err.read().decode(errors="replace")
        try:
            return err.code, json.loads(text)
        except json.JSONDecodeError:
            return err.code, {"message": text[:200]}


def f(obj: dict, key: str):
    """Read snake_case or lowerCamel."""
    if not isinstance(obj, dict):
        return None
    if key in obj:
        return obj[key]
    camel = key.split("_")[0] + "".join(p.title() for p in key.split("_")[1:])
    return obj.get(camel)


def op_id(body: dict) -> str:
    return f(f(body, "async_operation") or {}, "id") or ""


def wait_op(key: str, oid: str, label: str, timeout: float = 600) -> None:
    deadline = time.monotonic() + timeout
    while True:
        status, body = ops(key, "GET", f"/cloud/operations/{oid}")
        if status != 200:
            raise RuntimeError(f"{label}: GET operation {oid} -> {status} {body.get('message', '')}")
        aop = f(body, "async_operation") or {}
        state = f(aop, "state")
        if state == "STATE_FULFILLED":
            return
        if state in ("STATE_FAILED", "STATE_CANCELLED", "STATE_REJECTED"):
            raise RuntimeError(f"{label}: operation {oid} {state}: {f(aop, 'failure_reason')}")
        if time.monotonic() > deadline:
            raise RuntimeError(f"{label}: operation {oid} still {state}")
        time.sleep(3)


def get_ns(key: str, ns: str) -> tuple[int, dict]:
    status, body = ops(key, "GET", f"/cloud/namespaces/{ns}")
    return status, (f(body, "namespace") or {}) if status == 200 else body


def wait_ns_active(key: str, ns: str, timeout: float = 600) -> dict:
    deadline = time.monotonic() + timeout
    while True:
        status, n = get_ns(key, ns)
        if status == 200 and f(n, "state") == "RESOURCE_STATE_ACTIVE":
            return n
        if time.monotonic() > deadline:
            raise RuntimeError(f"namespace {ns} not active (status {status}, state {f(n, 'state')})")
        time.sleep(5)


def find_sa(key: str, name: str) -> dict | None:
    token = ""
    while True:
        status, body = ops(key, "GET", "/cloud/service-accounts", query={"page_token": token} if token else None)
        if status != 200:
            return None
        for sa in f(body, "service_account") or []:
            if f(f(sa, "spec") or {}, "name") == name:
                return sa
        token = f(body, "next_page_token") or ""
        if not token:
            return None


# ---------------------------------------------------------------------------
# Verdicts for calls that MUST be refused
# ---------------------------------------------------------------------------


def expect_refused(label: str, status: int, body: dict) -> bool:
    """403/404 = refused. Anything else means the call got past authorization."""
    msg = (body.get("message") or "")[:120] if isinstance(body, dict) else ""
    if status in (403, 404):
        record("REFUSED", label, f"{status} {msg}")
        return True
    if status == 401:
        record("ERROR", label, "401 — the key itself was rejected; probe is broken, not a pass")
        return False
    record("FAIL", label, f"{status} {msg} — got past authorization")
    return False


def note_read(label: str, status: int, body: dict) -> None:
    msg = (body.get("message") or "")[:100] if isinstance(body, dict) else ""
    verdict = "REFUSED" if status in (403, 404) else ("NOTE" if status == 200 else "ERROR")
    record(verdict, label, f"{status} {msg}" + ("  (read visibility only; not a mutation)" if status == 200 else ""))


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


@dataclass
class Made:
    ns: str
    sa_id: str = ""
    key_id: str = ""
    token: str = field(default="", repr=False)


# ---------------------------------------------------------------------------
# Phase 1: authorized controls (each env creates its own throwaway)
# ---------------------------------------------------------------------------


def create_throwaway(e: str, pkey: str) -> Made:
    print(f"\n== 1. {e} provisioner creates its own throwaway (authorized control)", flush=True)
    made = Made(ns=ns_id(e))
    status, _ = get_ns(pkey, made.ns)
    if status == 200:
        raise RuntimeError(f"{made.ns} already exists — run with --cleanup first")

    status, body = ops(pkey, "POST", "/cloud/namespaces", {
        "spec": {"name": THROWAWAY[e], "retention_days": 1, "api_key_auth": {"enabled": True},
                 "replicas": [{"region": REGION}]},
        "async_operation_id": f"guardrail-{e}-ns-{uuid.uuid4().hex[:8]}",
    })
    if status != 200:
        record("FAIL", f"{e}: create namespace {made.ns}", f"{status} {body.get('message', '')}")
        raise RuntimeError("authorized control failed: cannot create own namespace")
    wait_op(pkey, op_id(body), "create namespace")
    wait_ns_active(pkey, made.ns)
    record("OK", f"{e}: create namespace {made.ns}")

    status, body = ops(pkey, "POST", "/cloud/service-accounts", {
        "spec": {"name": f"{THROWAWAY[e]}-writer", "description": "guardrail probe (throwaway)",
                 "namespace_scoped_access": {"namespace": made.ns,
                                             "access": {"permission": "PERMISSION_WRITE"}}},
        "async_operation_id": f"guardrail-{e}-sa-{uuid.uuid4().hex[:8]}",
    })
    if status != 200:
        record("FAIL", f"{e}: create scoped Write SA on own namespace", f"{status} {body.get('message', '')}")
        raise RuntimeError("authorized control failed: cannot create scoped service account")
    made.sa_id = f(body, "service_account_id")
    wait_op(pkey, op_id(body), "create scoped SA")
    record("OK", f"{e}: create scoped Write SA on own namespace", made.sa_id)
    found = find_sa(pkey, f"{THROWAWAY[e]}-writer")
    record("OK" if found else "NOTE", f"{e}: scoped SA visible by name in GET /cloud/service-accounts",
           "yes" if found else "NO — the provisioner's findServiceAccountByName resume path can't see it")

    expiry = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    status, body = ops(pkey, "POST", "/cloud/api-keys", {
        "spec": {"owner_id": made.sa_id, "owner_type": "OWNER_TYPE_SERVICE_ACCOUNT",
                 "display_name": f"{THROWAWAY[e]}-key", "expiry_time": expiry},
        "async_operation_id": f"guardrail-{e}-key-{uuid.uuid4().hex[:8]}",
    })
    if status != 200 or not f(body, "token"):
        record("FAIL", f"{e}: create key for own scoped SA", f"{status} {body.get('message', '')}")
        raise RuntimeError("authorized control failed: cannot create key")
    made.key_id, made.token = f(body, "key_id"), f(body, "token")
    wait_op(pkey, op_id(body), "create key")
    record("OK", f"{e}: create 1-day key for own scoped SA", made.key_id)
    return made


# ---------------------------------------------------------------------------
# Phase 2: cross-env refusals on the Cloud Ops API
# ---------------------------------------------------------------------------


def cross_env(actor: str, akey: str, victim: Made, victim_env: str, vkey: str, actor_made: Made) -> None:
    print(f"\n== 2. {actor} provisioner vs {victim_env}'s throwaway {victim.ns} (must be refused)", flush=True)
    status, body = get_ns(akey, victim.ns)
    note_read(f"{actor}: get {victim.ns}", status, body)

    # Resource versions as the CREATOR sees them, so a refusal can't be a stale-version error.
    _, vns = get_ns(vkey, victim.ns)
    _, vkeyobj = ops(vkey, "GET", f"/cloud/api-keys/{victim.key_id}")
    key_rv = f(f(vkeyobj, "api_key") or {}, "resource_version") or ""

    status, body = ops(akey, "POST", "/cloud/service-accounts", {
        "spec": {"name": f"guardrail-{actor}-intruder-{uuid.uuid4().hex[:6]}",
                 "namespace_scoped_access": {"namespace": victim.ns,
                                             "access": {"permission": "PERMISSION_WRITE"}}},
        "async_operation_id": f"guardrail-x-{uuid.uuid4().hex[:8]}",
    })
    if not expect_refused(f"{actor}: create scoped SA on {victim.ns}", status, body) and status == 200:
        cleanup_intruder_sa(akey, f(body, "service_account_id"))

    status, body = ops(akey, "POST", f"/cloud/namespaces/{victim.ns}/service-accounts/{actor_made.sa_id}/access", {
        "access": {"permission": "PERMISSION_ADMIN"}, "resource_version": sa_rv(akey, actor_made.sa_id),
        "async_operation_id": f"guardrail-x-{uuid.uuid4().hex[:8]}",
    })
    expect_refused(f"{actor}: grant own SA Admin on {victim.ns}", status, body)

    status, body = ops(akey, "POST", "/cloud/api-keys", {
        "spec": {"owner_id": victim.sa_id, "owner_type": "OWNER_TYPE_SERVICE_ACCOUNT",
                 "display_name": f"guardrail-{actor}-intruder-key",
                 "expiry_time": (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")},
        "async_operation_id": f"guardrail-x-{uuid.uuid4().hex[:8]}",
    })
    if not expect_refused(f"{actor}: mint key for {victim_env}'s scoped SA", status, body) and status == 200:
        ops(vkey, "DELETE", f"/cloud/api-keys/{f(body, 'key_id')}", query={"async_operation_id": f"guardrail-c-{uuid.uuid4().hex[:8]}"})

    status, body = ops(akey, "DELETE", f"/cloud/api-keys/{victim.key_id}",
                       query={"resource_version": key_rv, "async_operation_id": f"guardrail-x-{uuid.uuid4().hex[:8]}"})
    expect_refused(f"{actor}: delete {victim_env}'s tenant key", status, body)

    status, body = ops(akey, "DELETE", f"/cloud/namespaces/{victim.ns}",
                       query={"resource_version": f(vns, "resource_version") or "",
                              "async_operation_id": f"guardrail-x-{uuid.uuid4().hex[:8]}"})
    expect_refused(f"{actor}: delete namespace {victim.ns}", status, body)


def vs_platform(actor: str, akey: str, actor_made: Made) -> None:
    for e in ENVS:
        ns = PLATFORM_NS[e]
        print(f"\n== 3. {actor} provisioner vs platform namespace {ns} (must be refused; no deletes sent)", flush=True)
        status, body = get_ns(akey, ns)
        note_read(f"{actor}: get {ns}", status, body)
        status, body = ops(akey, "POST", "/cloud/service-accounts", {
            "spec": {"name": f"guardrail-{actor}-intruder-{uuid.uuid4().hex[:6]}",
                     "namespace_scoped_access": {"namespace": ns,
                                                 "access": {"permission": "PERMISSION_WRITE"}}},
            "async_operation_id": f"guardrail-x-{uuid.uuid4().hex[:8]}",
        })
        if not expect_refused(f"{actor}: create scoped SA on {ns}", status, body) and status == 200:
            cleanup_intruder_sa(akey, f(body, "service_account_id"))
        status, body = ops(akey, "POST", f"/cloud/namespaces/{ns}/service-accounts/{actor_made.sa_id}/access", {
            "access": {"permission": "PERMISSION_WRITE"}, "resource_version": sa_rv(akey, actor_made.sa_id),
            "async_operation_id": f"guardrail-x-{uuid.uuid4().hex[:8]}",
        })
        if not expect_refused(f"{actor}: grant own SA Write on {ns}", status, body) and status == 200:
            print(f"  !! {actor_made.sa_id} may now hold Write on {ns}; it is deleted with its namespace in cleanup", flush=True)


def sa_rv(key: str, sa_id: str) -> str:
    _, body = ops(key, "GET", f"/cloud/service-accounts/{sa_id}")
    return f(f(body, "service_account") or {}, "resource_version") or ""


def cleanup_intruder_sa(key: str, sa_id: str | None) -> None:
    if not sa_id:
        return
    _, body = ops(key, "GET", f"/cloud/service-accounts/{sa_id}")
    rv = f(f(body, "service_account") or {}, "resource_version") or ""
    ops(key, "DELETE", f"/cloud/service-accounts/{sa_id}",
        query={"resource_version": rv, "async_operation_id": f"guardrail-c-{uuid.uuid4().hex[:8]}"})
    print(f"  (cleaned up intruder service account {sa_id})", flush=True)


def no_key_control() -> None:
    print("\n== 0. Control: no key", flush=True)
    status, body = ops(None, "GET", "/cloud/namespaces")
    record("OK" if status in (401, 403) else "FAIL", "no key: list namespaces", f"{status} (expect 401)")


# ---------------------------------------------------------------------------
# Phase 4: tenant keys across envs (gRPC data plane) — the Phase 2 probe
# ---------------------------------------------------------------------------


async def grpc_phase(made: dict[str, Made]) -> None:
    from google.protobuf.duration_pb2 import Duration
    from temporalio.api.common.v1 import WorkflowExecution, WorkflowType
    from temporalio.api.taskqueue.v1 import TaskQueue
    from temporalio.api.workflowservice.v1 import (
        DescribeNamespaceRequest, DescribeWorkflowExecutionRequest, ListWorkflowExecutionsRequest,
        PollWorkflowTaskQueueRequest, SignalWorkflowExecutionRequest, StartWorkflowExecutionRequest,
    )
    from temporalio.client import Client
    from temporalio.service import RPCError, RPCStatusCode

    refused_codes = {RPCStatusCode.PERMISSION_DENIED, RPCStatusCode.UNAUTHENTICATED}
    bogus_tq = "guardrail-probe-noop"

    async def suite(key: str, endpoint: str, ns: str) -> list[str]:
        try:
            c = await Client.connect(endpoint, namespace=ns, api_key=key, tls=True)
        except Exception as e:  # noqa: BLE001
            return [f"refused-at-connect [{type(e).__name__}]"]
        svc, rid = c.workflow_service, f"guardrail-probe-{uuid.uuid4()}"
        calls = {
            "DescribeNamespace": lambda: svc.describe_namespace(DescribeNamespaceRequest(namespace=ns)),
            "ListWorkflowExecutions": lambda: svc.list_workflow_executions(
                ListWorkflowExecutionsRequest(namespace=ns, page_size=1)),
            "DescribeWorkflowExecution": lambda: svc.describe_workflow_execution(
                DescribeWorkflowExecutionRequest(namespace=ns, execution=WorkflowExecution(workflow_id=rid))),
            "SignalWorkflowExecution": lambda: svc.signal_workflow_execution(SignalWorkflowExecutionRequest(
                namespace=ns, workflow_execution=WorkflowExecution(workflow_id=rid), signal_name="ping",
                identity="guardrail-probe")),
            "StartWorkflowExecution": lambda: svc.start_workflow_execution(StartWorkflowExecutionRequest(
                namespace=ns, workflow_id=rid, workflow_type=WorkflowType(name="GuardrailProbeNoop"),
                task_queue=TaskQueue(name=bogus_tq), workflow_execution_timeout=Duration(seconds=5),
                request_id=str(uuid.uuid4()), identity="guardrail-probe")),
            "PollWorkflowTaskQueue": lambda: svc.poll_workflow_task_queue(PollWorkflowTaskQueueRequest(
                namespace=ns, task_queue=TaskQueue(name=bogus_tq), identity="guardrail-probe"),
                timeout=timedelta(seconds=5)),
        }
        out = []
        for name, call in calls.items():
            try:
                await call()
                out.append(f"{name}: LEAK (succeeded)")
            except RPCError as e:
                out.append(f"{name}: " + ("refused" if e.status in refused_codes else "LEAK?") + f" [{e.status.name}]")
            except Exception as e:  # noqa: BLE001
                out.append(f"{name}: refused-at-transport? [{type(e).__name__}]")
        return out

    for e in ENVS:
        m = made[e]
        own_ep = f"{m.ns}.tmprl.cloud:7233"
        print(f"\n== 4. {e} tenant key: wait until authorized on its own namespace (~90 s seen)", flush=True)
        deadline = time.monotonic() + 600
        while True:
            try:
                c = await Client.connect(own_ep, namespace=m.ns, api_key=m.token, tls=True)
                await c.workflow_service.describe_namespace(DescribeNamespaceRequest(namespace=m.ns))
                record("OK", f"{e} tenant key: DescribeNamespace on own {m.ns}")
                break
            except Exception as err:  # noqa: BLE001
                if time.monotonic() > deadline:
                    record("ERROR", f"{e} tenant key never authorized on own namespace", type(err).__name__)
                    return
                await asyncio.sleep(10)

        print(f"\n== 5. Control: {e} tenant key, negative suite aimed at its OWN namespace (must flag 6/6)", flush=True)
        # A new key's permissions land per API, not all at once (seen 2026-10-11:
        # DescribeNamespace authorized while Poll/DescribeWorkflowExecution were
        # still PERMISSION_DENIED). Refusals elsewhere only mean something once
        # the control is fully authorized, so wait for 6/6 first.
        started = time.monotonic()
        while True:
            ctl = await suite(m.token, own_ep, m.ns)
            flagged = sum("LEAK" in v for v in ctl)
            if flagged == len(ctl) or time.monotonic() - started > 900:
                break
            print(f"  ... control {flagged}/{len(ctl)} after {int(time.monotonic() - started)}s; retrying", flush=True)
            await asyncio.sleep(15)
        waited = int(time.monotonic() - started)
        record("OK" if flagged == len(ctl) else "ERROR",
               f"{e} control: {flagged}/{len(ctl)} flagged (full authorization {waited}s after DescribeNamespace)",
               "; ".join(ctl))
        if flagged != len(ctl):
            continue

        o = other(e)
        for target_ns in (made[o].ns, PLATFORM_NS[o]):
            for ep_name, ep in (("namespace-endpoint", f"{target_ns}.tmprl.cloud:7233"), ("regional-endpoint", REGIONAL_EP)):
                res = await suite(m.token, ep, target_ns)
                leaks = [v for v in res if "LEAK" in v]
                record("FAIL" if leaks else "REFUSED", f"{e} tenant key -> {target_ns} via {ep_name}", "; ".join(res))


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------


def cleanup(keys: dict[str, str]) -> None:
    print("\n== 6. Cleanup (each env deletes what it created)", flush=True)
    for e in ENVS:
        pkey, ns = keys[e], ns_id(e)
        sa = find_sa(pkey, f"{THROWAWAY[e]}-writer")
        if sa:
            # The provisioner can't LIST a tenant account's keys (403, found in
            # Step 9 run 1, 2026-10-13); this probe once ignored that status and
            # deleted nothing. Report it, then delete by the id it created.
            status, body = ops(pkey, "GET", "/cloud/api-keys",
                               query={"owner_id": f(sa, "id"), "owner_type": "OWNER_TYPE_SERVICE_ACCOUNT"})
            print(f"  {e}: list the scoped SA's keys -> {status} "
                  f"{'(expected: the provisioner may not list them)' if status == 403 else body.get('message', '')}",
                  flush=True)
        m = MADE.get(e)
        if m and m.key_id:
            s, k = ops(pkey, "GET", f"/cloud/api-keys/{m.key_id}")
            if s == 200:
                s, b = ops(pkey, "DELETE", f"/cloud/api-keys/{m.key_id}",
                           query={"resource_version": f(f(k, "api_key"), "resource_version") or "",
                                  "async_operation_id": f"guardrail-c-{uuid.uuid4().hex[:8]}"})
                if s == 200:
                    wait_op(pkey, op_id(b), "delete key")
            print(f"  {e}: delete key {m.key_id} by id -> {s}", flush=True)
        status, n = get_ns(pkey, ns)
        if status == 200:
            s, b = ops(pkey, "DELETE", f"/cloud/namespaces/{ns}",
                       query={"resource_version": f(n, "resource_version") or "",
                              "async_operation_id": f"guardrail-c-{uuid.uuid4().hex[:8]}"})
            if s == 200:
                wait_op(pkey, op_id(b), "delete namespace")
            print(f"  {e}: delete namespace {ns} -> {s}", flush=True)
        else:
            print(f"  {e}: namespace {ns} not present ({status})", flush=True)
        sa = find_sa(pkey, f"{THROWAWAY[e]}-writer")
        if sa:
            cleanup_intruder_sa(pkey, f(sa, "id"))
        status, _ = get_ns(pkey, ns)
        print(f"  {e}: verify namespace gone -> {status} {'OK' if status == 404 else ('UNKNOWN: a 403 can hide it' if status == 403 else 'STILL PRESENT?')}", flush=True)
        m = MADE.get(e)
        if m and m.sa_id:
            s1, _ = ops(pkey, "GET", f"/cloud/service-accounts/{m.sa_id}")
            print(f"  {e}: verify scoped SA {m.sa_id} gone -> {s1} {'OK' if s1 == 404 else ('UNKNOWN: a 403 can hide it' if s1 == 403 else 'STILL PRESENT?')}", flush=True)
        if m and m.key_id:
            s2, _ = ops(pkey, "GET", f"/cloud/api-keys/{m.key_id}")
            print(f"  {e}: verify tenant key {m.key_id} gone -> {s2} {'OK' if s2 == 404 else ('UNKNOWN: a 403 can hide it' if s2 == 403 else 'STILL PRESENT?')}", flush=True)


# ---------------------------------------------------------------------------


def main() -> int:
    keys = {e: provisioner_key(e) for e in ENVS}
    if "--cleanup" in sys.argv:
        cleanup(keys)
        return 0
    made: dict[str, Made] = MADE
    try:
        no_key_control()
        for e in ENVS:
            made[e] = create_throwaway(e, keys[e])
        for e in ENVS:
            cross_env(e, keys[e], made[other(e)], other(e), keys[other(e)], made[e])
        for e in ENVS:
            vs_platform(e, keys[e], made[e])
        asyncio.run(grpc_phase(made))
    except Exception as err:  # noqa: BLE001
        record("ERROR", "probe aborted", f"{type(err).__name__}: {str(err)[:200]}")
    finally:
        cleanup(keys)

    fails = [r for r in RESULTS if r[0] in ("FAIL", "ERROR")]
    print("\n== SUMMARY")
    for verdict in ("OK", "REFUSED", "NOTE", "FAIL", "ERROR"):
        print(f"  {verdict:<7} {sum(r[0] == verdict for r in RESULTS)}")
    if fails:
        print("  RESULT: NOT PASSED — STOP, do not merge the enable PR. Failures:")
        for v, label, detail in fails:
            print(f"    [{v}] {label} — {detail}")
        return 1
    print("  RESULT: PASSED — every cross-env and platform mutation was refused; controls held.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
