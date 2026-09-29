# Phase 2: durable-workflow isolation spike

- **Branch:** `docs/durable-workflow-isolation-spike` (worktree
  `../pegasus-durable-workflow-isolation-spike`). All Phase 2 changes stay on
  this branch.
- **Goal:** decide D5 (how durable tenant Workflow code gets a Temporal
  connection without reaching other tenants) and D4's revisit trigger 1
  (whether Temporal Cloud can isolate tenants).
- **Master plan:** `plans/in-progress/long-running-workflows-and-automations.md`.
  D4, D5 and the option list are defined there. This file is the Phase 2
  working checklist, copied verbatim from that plan's Phase 2 section. When the
  phase lands, record the outcome in the master plan (D5 resolution, D4
  trigger 1, Phase 2 boxes ticked) and archive this file.

### Phase 2: Isolation spike + Cloud confirmation (branch `docs/durable-workflow-isolation-spike`)

A time-boxed investigation. Its output is a written decision, not production code.

- [x] Temporal Cloud questions to answer (confirm against current Cloud docs,
      not memory). Answered 2026-09-29; see **Findings §1** below.
  - The namespace limit per account and how to raise it.
  - Pricing per namespace and any minimums.
  - Whether service-account API keys can be limited to one namespace, and
    with what permissions (worker-only?).
  - Provisioning and rotating namespaces and keys through the Cloud Ops API,
    `tcld` or Terraform.
  - Whether the API Lambda can start and signal across namespaces with one
    platform key.
- [x] Prototype option A in a throwaway namespace: a worker holding a
      namespace-scoped key must fail to reach a second namespace. **Passed,
      2026-09-29**; see §4.
- [x] If A fails: prototype option B. **Not needed:** A passed.
- [x] Record the result as the resolution of D5, and the result of D4's
      revisit trigger 1. **D5 → option A, with the conditions in §5.** D4
      trigger 1 → **not met**: Cloud isolates tenants, so stay on Cloud.
- [x] Record the effect on the tenant runner's hardening: see §5 and §6.
- **Stop point:** if neither A nor B is acceptable, return to the user before
  Phase 3. Self-hosting (D4) or declarative Workflows (D1's rejected
  option) come back up for discussion.

---

## Findings

### §1 Temporal Cloud, from current docs (read-only research, 2026-09-29)

Sources are `docs.temporal.io` (`/cloud/limits`, `/cloud/pricing`,
`/cloud/service-accounts`, `/cloud/manage-access/permissions-reference`,
`/cloud/api-keys`, `/cloud/connectivity`, `/cloud/nexus`,
`/production-deployment/worker-deployments/worker-versioning`) and
`temporal.io/pricing`. **Treat these as claims to verify, not facts**, where
marked.

| Question                                               | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Confidence                                                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Namespace limit                                        | 10 by default. It grows automatically with active use up to **100**; beyond that needs a support ticket. **Counted per account, and staging and prod share one (`chgel`)**: N tenants in both environments means about 2N tenant namespaces, plus the 2 platform ones.                                                                                                                                                                                                        | High                                                                                                                               |
| Per-namespace cost                                     | **None documented.** Billing is Actions ($50/M on Developer; tiered discounts on Business) plus Active and Retained Storage, summed across the account. High-availability replication doubles Actions and Storage for any namespace it's enabled on.                                                                                                                                                                                                                          | High                                                                                                                               |
| Namespace-scoped keys                                  | **GA.** A _namespace-scoped service account_ is bound to exactly one namespace and can't be re-pointed; deleting the namespace deletes it. Permission levels are **Read** (list, describe, query), **Write** (Read plus start, signal, signal-with-start, terminate, delete executions, schedules), and **Admin** (Write plus namespace administration). **Write is the worker tier.** Namespace admins can create these accounts, so onboarding doesn't need a global admin. | High                                                                                                                               |
| Namespace-scoped key reaching _another_ namespace      | **Not documented either way.** Implied no, by design.                                                                                                                                                                                                                                                                                                                                                                                                                         | **Must test.** This is the whole isolation claim.                                                                                  |
| Finer authorization (task queue or workflow-id prefix) | **Doesn't exist.** Authorization stops at the namespace boundary.                                                                                                                                                                                                                                                                                                                                                                                                             | High                                                                                                                               |
| Automation                                             | Everything goes through the Cloud Ops API (HTTP and gRPC), `tcld`, or the Terraform provider. A new namespace becomes usable in about 2 minutes (a community figure, no SLA). API keys last **at most 2 years**; rotation is generate, switch, delete.                                                                                                                                                                                                                        | Medium on latency                                                                                                                  |
| One platform key across namespaces                     | An account-level service account can hold grants on many namespaces. Each namespace has its own endpoint (`<ns>.<acct>.tmprl.cloud:7233`), **but the live test found a regional endpoint** (`us-east-1.aws.api.temporal.io:7233`) that takes the namespace per request. It refused staging with `PERMISSION_DENIED`, not "unknown namespace". So the API Lambda may need only **one** connection.                                                                             | Inferred; the positive case (a platform key serving many namespaces through the regional endpoint) is untested. Verify in Phase 3. |
| Nexus                                                  | GA on Cloud. A workflow in namespace A can call an operation that namespace B exposes, through an endpoint with an **admin-managed allowlist of caller namespaces**. The caller pays one Action per operation.                                                                                                                                                                                                                                                                | High                                                                                                                               |
| Worker versioning                                      | **GA** (2026). _Pinned_ behavior keeps an execution on the deployment version it started on. Upgrade-on-continue-as-new is in public preview.                                                                                                                                                                                                                                                                                                                                 | High on GA; medium on the date                                                                                                     |
| History limits                                         | 51,200 events or 50 MB (hard); warnings at 10,240 events or 10 MB. At most 10,000 signals per execution.                                                                                                                                                                                                                                                                                                                                                                      | High                                                                                                                               |

### §2 This codebase today (verified in code)

- **The tenant runner container already holds the platform-wide key.**
  `temporal-worker-stack.ts` injects `TEMPORAL_CLOUD_API_KEY` (the single
  key for `pegasus-<env>.chgel.tmprl.cloud`) into every tenant-runner task.
  Tenant code runs as a subprocess in that same container under the same
  uid. The key is kept from it only by the env allowlist (`sandbox_env.py`)
  and `PR_SET_DUMPABLE=0` (`hardening.py`). The Phase 3 plan recorded the
  remaining risk as "shared kernel only": a kernel escape today yields a
  key to **every** tenant's executions.
- Endpoints are already per namespace (`TEMPORAL_ADDRESS` in
  `packages/infra/bin/app.ts`), so per-tenant namespaces fit the existing
  connection code.

### §3 Live test: what was done (2026-09-29, with the user's go-ahead)

In Cloud account `chgel` (AWS us-east-1), using `tcld` v0.55.0 built from source
and `temporalio` 1.33.0 (Python):

1. Created the throwaway namespace `pegasus-iso-spike` (API-key auth, 1-day
   retention), a **namespace-scoped** service account `iso-spike-worker` with
   **Write** on it, and a 1-day API key.
2. Ran `probe.py` (Appendix A) with that one key. It checks the key's own
   namespace works, then sends 6 RPCs at `pegasus-staging` through **both**
   the namespace endpoint and the regional endpoint. Staging probes used only
   random workflow ids and a bogus task queue (`iso-spike-probe-noop`), and
   any start that unexpectedly succeeded had a 5 s timeout, so a leak couldn't
   touch real tenant work.
3. Ran a **control**: the same probe aimed at the key's _own_ namespace, where
   every call is authorized. The probe must flag all 6, which proves it would
   catch a real leak, and that staging's refusals are scope decisions rather
   than a broken probe.
4. Probed the Cloud management API with the key (`tcld` with an empty `HOME`,
   so it can't fall back to the operator's saved login; a no-key control
   confirmed that).
5. Tore everything down: both spike keys, the service account, and the
   namespace. Afterwards `namespace list` shows only `pegasus-prod` and
   `pegasus-staging`, and `apikey list` only their two original keys.

### §4 Results (verbatim transcripts)

**Isolation probe:** the key works its own namespace; 12 of 12 staging calls
are refused.

```
== positive: own namespace pegasus-iso-spike.chgel
  start+worker+signal+query OK: query='hello' result='hello'
== negative: pegasus-staging.chgel via namespace-endpoint (pegasus-staging.chgel.tmprl.cloud:7233)
  DescribeNamespace            refused [PERMISSION_DENIED] Request unauthorized.
  ListWorkflowExecutions       refused [PERMISSION_DENIED] Request unauthorized.
  DescribeWorkflowExecution    refused [PERMISSION_DENIED] Request unauthorized.
  SignalWorkflowExecution      refused [PERMISSION_DENIED] Request unauthorized.
  StartWorkflowExecution       refused [PERMISSION_DENIED] Request unauthorized.
  PollWorkflowTaskQueue        refused [PERMISSION_DENIED] Request unauthorized.
== negative: pegasus-staging.chgel via regional-endpoint (us-east-1.aws.api.temporal.io:7233)
  DescribeNamespace            refused [PERMISSION_DENIED] Request unauthorized.
  ListWorkflowExecutions       refused [PERMISSION_DENIED] Request unauthorized.
  DescribeWorkflowExecution    refused [PERMISSION_DENIED] Request unauthorized.
  SignalWorkflowExecution      refused [PERMISSION_DENIED] Request unauthorized.
  StartWorkflowExecution       refused [PERMISSION_DENIED] Request unauthorized.
  PollWorkflowTaskQueue        refused [PERMISSION_DENIED] Request unauthorized.
== SUMMARY: NO LEAKS
```

**Control:** the probe flags 6 of 6 authorized calls, so it does detect leaks.

```
== negative: pegasus-iso-spike.chgel via own-namespace-endpoint (control) (pegasus-iso-spike.chgel.tmprl.cloud:7233)
  DescribeNamespace            LEAK (call succeeded)
  ListWorkflowExecutions       LEAK (call succeeded)
  DescribeWorkflowExecution    LEAK? [NOT_FOUND] workflow not found for ID: iso-spike-probe-af8c6532-980a-465b-b64d-34ad20aae460
  SignalWorkflowExecution      LEAK? [NOT_FOUND] workflow not found for ID: iso-spike-probe-af8c6532-980a-465b-b64d-34ad20aae460
  StartWorkflowExecution       LEAK (call succeeded)
  PollWorkflowTaskQueue        LEAK (call succeeded)
== CONTROL: 6/6 calls flagged as reaching past authz (expect 6)
```

**Cloud management API** (email and login code redacted):

```
CONTROL no key: ns list        rc=124  Login via this url: https://login.tmprl.cloud/activate?user_code=<redacted>
namespace list                 rc=0  { "namespaces": [ "pegasus-iso-spike.chgel" ], "nextPageToken": "" }
namespace get staging          rc=1  rpc error: code = PermissionDenied desc = request unauthorized
namespace get prod             rc=1  rpc error: code = PermissionDenied desc = request unauthorized
namespace get own              rc=0  { "namespace": "pegasus-iso-spike.chgel", "resourceVersion": "475238d1-9203-46d4-90fe-7de8f9754478", "spec": { "a
user list                      rc=0  { "users": [ { "id": "f1c1e07d91e84eb2b007a7246d9fe906", "resourceVersion": "e249f9de-1897-46d2-8d8c-f5230386cf35
service-account list           rc=0  { "serviceAccount": [ ], "nextPageToken": "" }
apikey list                    rc=0  { "apiKeys": [ { "id": "ft5g6L03h9finoybrxnoBs23EjsoUYoP", "owner": { "ownerId": "7664da63cf35445b96538e0b3dd5c27
account get                    rc=0  { "resourceVersion": "", "spec": { "metrics": { "enabled": false, "acceptedClientCa": "" }, "outputSinks": { } },
```

**Other observations from the run:**

- **Propagation delay.** For about 60–90 s after creation, the new key got
  `PERMISSION_DENIED` on _its own_ namespace, then became authorized with no
  other change. Provisioning must wait for readiness before launching a
  runner.
- **Namespace-scoped accounts must keep account-level `Read`.** Trying to
  lower it to `MetricsRead` was rejected: _"namespace scoped service accounts
  must have a read-only account role"_.
- **Today's platform keys are namespace-scoped with Admin.** Both
  `pegasus-prod-service-account` and `pegasus-staging-service-account` are
  `scope: Namespace`, with **Admin** on their own namespace only. So they can
  never reach a new tenant namespace (a scoped account can't be re-pointed),
  and the key every tenant-runner task holds today has _namespace Admin_,
  which includes deleting the namespace and managing access. Workers need only
  Write.
- The Cloud management API host is **`saas-api.tmprl.cloud:443`** (from the
  `tcld` source), and login is at `login.tmprl.cloud`.

### §5 Decision: D5 resolves to option A, with conditions

**A namespace per tenant, holding a namespace-scoped Write key, isolates
tenants.** It was shown live across 12 RPCs and both endpoints, with a
control. Option B (a gRPC proxy) is not needed. **D4 revisit trigger 1 is not
met**, so we stay on Temporal Cloud.

The conditions Phase 3 must meet for this to hold, or to improve on today:

1. **Automations move into the tenant namespace too.** A per-tenant key only
   takes the platform key _out of_ tenant containers if the runner no longer
   needs it. Today the runner polls `tenant-<id>` in the _platform_ namespace
   for Automations, using the platform key. If Workflows get a tenant key
   while Automations keep that routing, the runner holds **both** keys: the
   same exposure as today, plus tenant code with a live Temporal connection
   in the same container. So the API must start each tenant's Automations in
   that tenant's namespace, and the runner holds only the scoped key. **This
   is a migration of existing Automation routing, and it's added to Phase 3.**
2. **A new platform service account.** It must be account-scoped (not
   namespace-scoped), and gain **Write** on each tenant namespace at
   provisioning time. The existing scoped Admin accounts can't reach new
   namespaces.
3. **Provisioning waits for readiness.** Create the namespace, then the scoped
   service account, then the key, then retry until authorized (about 90 s
   seen), and only then launch the runner.
4. **Plan for the namespace cap.** At under 50 tenants (the user's estimate,
   2026-09-29), with staging and prod sharing the account, the 100 cap may be
   reached. Ask Temporal support to raise it before we get close.

### §6 Residual risk: tenant code can list the Cloud account's users

Every namespace-scoped key carries the mandatory account-level `Read` role, and
through the management API that role returned **`user list`**: every account
user's email and account role (one user today). Other tenants' data, namespaces,
service accounts and keys were not visible.

- **Not enumerated:** only 7 management calls were probed. `user-group list`,
  `nexus`, `connectivity-rule` and similar were not; assume the role reads
  anything read-only at account level.
- **Doesn't change D5:** every candidate has this exposure once tenant code
  holds any Temporal Cloud key, and the role can't be lowered.
- **Mitigation candidate (Phase 3):** block `saas-api.tmprl.cloud` from the
  tenant-runner VPC (e.g. Route 53 Resolver DNS Firewall). The runner's egress
  is otherwise deliberately open ("Resolved #2 open-egress"), so this is a
  new control. Workers only need the namespace gRPC endpoint.

### §7 Follow-ups found along the way (outside this plan's scope)

- **Today's tenant runners hold a namespace-Admin key.** Tenant code that
  escaped the sandbox could delete the prod namespace or change its access
  rules. Workers need only Write, so issuing the runner (and the stdlib
  worker) a Write-level key would shrink that blast radius.
  **Disposition (user, 2026-09-29): rolled into Phase 3** as its own checklist
  item in the master plan.

---

## Appendix A: probe scripts (for re-running against real Phase 3 provisioning)

`probe.py`, the isolation probe (the positive case plus 6 RPCs through each of
2 endpoints):

```python
"""Phase 2 isolation probe.

Holds ONE namespace-scoped (Write on pegasus-iso-spike) API key and checks:
  1. positive: its own namespace works (worker + start + signal + query).
  2. negative: pegasus-staging refuses every RPC, via the namespace endpoint AND
     the regional endpoint. NOT_FOUND / OK / INVALID_ARGUMENT on staging count
     as a LEAK (the call got past authorization).
Safety: staging probes only use a bogus task queue and random workflow ids, and
any start that unexpectedly succeeds has a 5 s execution timeout.
"""

import asyncio
import uuid
from datetime import timedelta
from pathlib import Path

from google.protobuf.duration_pb2 import Duration
from temporalio import workflow
from temporalio.api.common.v1 import WorkflowExecution, WorkflowType
from temporalio.api.taskqueue.v1 import TaskQueue
from temporalio.api.workflowservice.v1 import (
    DescribeNamespaceRequest,
    DescribeWorkflowExecutionRequest,
    ListWorkflowExecutionsRequest,
    PollWorkflowTaskQueueRequest,
    SignalWorkflowExecutionRequest,
    StartWorkflowExecutionRequest,
)
from temporalio.client import Client
from temporalio.service import RPCError, RPCStatusCode
from temporalio.worker import Worker

KEY = Path(__file__).with_name("spike.key").read_text().strip()
OWN_NS = "pegasus-iso-spike.chgel"
OWN_EP = "pegasus-iso-spike.chgel.tmprl.cloud:7233"
STAGING_NS = "pegasus-staging.chgel"
TARGETS = {
    "namespace-endpoint": "pegasus-staging.chgel.tmprl.cloud:7233",
    "regional-endpoint": "us-east-1.aws.api.temporal.io:7233",
}
BOGUS_TQ = "iso-spike-probe-noop"
REFUSED = {RPCStatusCode.PERMISSION_DENIED, RPCStatusCode.UNAUTHENTICATED}


@workflow.defn(name="IsoSpikeWorkflow")
class IsoSpikeWorkflow:
    def __init__(self) -> None:
        self._got = ""

    @workflow.signal
    def ping(self, v: str) -> None:
        self._got = v

    @workflow.query
    def got(self) -> str:
        return self._got

    @workflow.run
    async def run(self) -> str:
        await workflow.wait_condition(lambda: self._got != "")
        return self._got


async def positive() -> None:
    print("== positive: own namespace", OWN_NS)
    c = await Client.connect(OWN_EP, namespace=OWN_NS, api_key=KEY, tls=True)
    tq = "iso-spike-tq"
    async with Worker(c, task_queue=tq, workflows=[IsoSpikeWorkflow]):
        wid = f"iso-spike-{uuid.uuid4()}"
        h = await c.start_workflow(
            IsoSpikeWorkflow.run, id=wid, task_queue=tq, execution_timeout=timedelta(minutes=2)
        )
        await h.signal(IsoSpikeWorkflow.ping, "hello")
        q = await h.query(IsoSpikeWorkflow.got)
        res = await h.result()
        print(f"  start+worker+signal+query OK: query={q!r} result={res!r}")


async def rpc(label: str, coro_fn) -> str:
    try:
        await coro_fn()
        verdict = "LEAK (call succeeded)"
    except RPCError as e:
        verdict = ("refused" if e.status in REFUSED else "LEAK?") + f" [{e.status.name}] {e.message[:140]}"
    except Exception as e:  # connection-level refusal etc.
        verdict = f"refused-at-connect? [{type(e).__name__}] {str(e)[:140]}"
    print(f"  {label:<28} {verdict}")
    return verdict


async def negative(target_name: str, target: str) -> list[str]:
    print(f"== negative: {STAGING_NS} via {target_name} ({target})")
    try:
        c = await Client.connect(target, namespace=STAGING_NS, api_key=KEY, tls=True)
    except Exception as e:
        print(f"  connect refused: [{type(e).__name__}] {str(e)[:200]}")
        return ["refused at connect"]
    svc = c.workflow_service
    rid = f"iso-spike-probe-{uuid.uuid4()}"
    out = []
    out.append(await rpc("DescribeNamespace", lambda: svc.describe_namespace(
        DescribeNamespaceRequest(namespace=STAGING_NS))))
    out.append(await rpc("ListWorkflowExecutions", lambda: svc.list_workflow_executions(
        ListWorkflowExecutionsRequest(namespace=STAGING_NS, page_size=1))))
    out.append(await rpc("DescribeWorkflowExecution", lambda: svc.describe_workflow_execution(
        DescribeWorkflowExecutionRequest(namespace=STAGING_NS, execution=WorkflowExecution(workflow_id=rid)))))
    out.append(await rpc("SignalWorkflowExecution", lambda: svc.signal_workflow_execution(
        SignalWorkflowExecutionRequest(namespace=STAGING_NS, workflow_execution=WorkflowExecution(workflow_id=rid),
                                       signal_name="ping", identity="iso-spike-probe"))))
    out.append(await rpc("StartWorkflowExecution", lambda: svc.start_workflow_execution(
        StartWorkflowExecutionRequest(namespace=STAGING_NS, workflow_id=rid,
                                      workflow_type=WorkflowType(name="IsoSpikeProbeNoop"),
                                      task_queue=TaskQueue(name=BOGUS_TQ),
                                      workflow_execution_timeout=Duration(seconds=5),
                                      request_id=str(uuid.uuid4()), identity="iso-spike-probe"))))
    out.append(await rpc("PollWorkflowTaskQueue", lambda: svc.poll_workflow_task_queue(
        PollWorkflowTaskQueueRequest(namespace=STAGING_NS, task_queue=TaskQueue(name=BOGUS_TQ),
                                     identity="iso-spike-probe"), timeout=timedelta(seconds=5))))
    return out


async def main() -> None:
    await positive()
    leaks = []
    for name, ep in TARGETS.items():
        for v in await negative(name, ep):
            if "LEAK" in v:
                leaks.append((name, v))
    print("== SUMMARY:", "NO LEAKS" if not leaks else f"{len(leaks)} LEAK(S): {leaks}")


if __name__ == "__main__":
    asyncio.run(main())
```

`control.py`, which aims the probe at its own namespace; it must flag every
call:

```python
"""Control: run probe.negative() against the key's OWN namespace.

Every call there is authorized, so the probe must report LEAK for them. That
proves a real cross-namespace leak would have been detected, and that staging's
PERMISSION_DENIED is a scope decision, not a broken probe.
"""

import asyncio

import probe


async def main() -> None:
    probe.STAGING_NS = probe.OWN_NS  # aim the negative suite at our own namespace
    out = await probe.negative("own-namespace-endpoint (control)", probe.OWN_EP)
    detected = sum("LEAK" in v for v in out)
    print(f"== CONTROL: {detected}/{len(out)} calls flagged as reaching past authz (expect {len(out)})")


if __name__ == "__main__":
    asyncio.run(main())
```

`cloudops_probe.sh`, the management-API probe (with an empty `HOME` and a
no-key control):

```bash
#!/usr/bin/env bash
# What does the namespace-scoped key's account-level "Read" role expose via the
# Cloud Ops API? Read-only calls only. The key is passed via env, never argv.
# HOME/XDG point at an empty dir so tcld cannot fall back to the operator's
# saved login; a no-key control proves that.
cd "$(dirname "$0")"
EMPTY_HOME="$(mktemp -d)"
T="$PWD/bin/tcld"
KEY="$(cat spike.key)"
run() {
  local label="$1" keyval="$2"; shift 2
  local out rc
  out=$(env -u TEMPORAL_CLOUD_API_KEY HOME="$EMPTY_HOME" XDG_CONFIG_HOME="$EMPTY_HOME" \
        ${keyval:+TEMPORAL_CLOUD_API_KEY="$keyval"} timeout 60 "$T" "$@" 2>&1); rc=$?
  printf '%-30s rc=%s  %s\n' "$label" "$rc" "$(echo "$out" | tr '\n\t' '  ' | tr -s ' ' | cut -c1-170)"
}
run "CONTROL no key: ns list"  ""     namespace list
run "namespace list"           "$KEY" namespace list
run "namespace get staging"    "$KEY" namespace get -n pegasus-staging.chgel
run "namespace get prod"       "$KEY" namespace get -n pegasus-prod.chgel
run "namespace get own"        "$KEY" namespace get -n pegasus-iso-spike.chgel
run "user list"                "$KEY" user list
run "service-account list"     "$KEY" service-account list
run "apikey list"              "$KEY" apikey list
run "account get"              "$KEY" account get
rm -rf "$EMPTY_HOME"
```
