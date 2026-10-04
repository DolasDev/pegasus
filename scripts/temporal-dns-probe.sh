#!/usr/bin/env bash
# temporal-dns-probe.sh — check, from inside the tenant-runner network, whether the
# Temporal Cloud Ops API (saas-api.tmprl.cloud) resolves.
#
# Acceptance check for durable-workflow Phase 3a: wireguard-stack.ts blocks that
# host with a Route 53 Resolver DNS Firewall. After it deploys, expect
#   saas-api.tmprl.cloud              -> FAILS (NXDOMAIN)
#   pegasus-<env>.chgel.tmprl.cloud   -> RESOLVES   (control: DNS itself works)
#
# Why a throwaway task definition: the tenant-runner image's ENTRYPOINT is fixed
# and ECS RunTask cannot override an entrypoint. So this registers
# `pegasus-dnsprobe-<env>` (stock python:3.12-slim, NO secrets) on the runner's
# cluster, subnets, security group and execution role, runs one lookup, prints
# the result, and deregisters the task definition on exit.
#
# Usage:  scripts/temporal-dns-probe.sh <staging|prod>
# Needs:  an AWS SSO session for profile dolas-pegasus-<env>
#         (aws sso login --sso-session dolas --use-device-code)
set -uo pipefail

env="${1:?usage: $0 <staging|prod>}"
case "$env" in staging|prod) ;; *) echo "env must be staging or prod" >&2; exit 2 ;; esac
P=(--profile "dolas-pegasus-$env" --region us-east-1)

acct=$(timeout 60 aws sts get-caller-identity "${P[@]}" --query Account --output text) || exit 1
cluster="arn:aws:ecs:us-east-1:$acct:cluster/pegasus-temporal-worker-$env"
fn=$(timeout 60 aws lambda list-functions "${P[@]}" \
  --query "Functions[?contains(FunctionName,'DispatchWorkflowTriggers')].FunctionName | [0]" --output text)
read -r subnets sg <<<"$(timeout 60 aws lambda get-function-configuration "${P[@]}" --function-name "$fn" \
  --query 'Environment.Variables.[TENANT_RUNNER_SUBNET_IDS,TENANT_RUNNER_SECURITY_GROUP_ID]' --output text)"
[ -n "${subnets:-}" ] && [ -n "${sg:-}" ] || { echo "could not read runner subnets/SG from $fn" >&2; exit 1; }

probe='import socket
for host in ("saas-api.tmprl.cloud", "pegasus-'"$env"'.chgel.tmprl.cloud"):
    try:
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443)})
        print(f"DNSPROBE {host}: RESOLVES {addrs}", flush=True)
    except socket.gaierror as e:
        print(f"DNSPROBE {host}: FAILS {e}", flush=True)'

taskdef=$(mktemp)
trap 'rm -f "$taskdef"' EXIT
python3 - "$env" "$acct" "$probe" >"$taskdef" <<'PY'
import json, sys
env, acct, probe = sys.argv[1:4]
print(json.dumps({
    "family": f"pegasus-dnsprobe-{env}",
    "requiresCompatibilities": ["FARGATE"],
    "networkMode": "awsvpc",
    "cpu": "256",
    "memory": "512",
    "executionRoleArn": f"arn:aws:iam::{acct}:role/pegasus-tenant-runner-exec-{env}",
    "containerDefinitions": [{
        "name": "dnsprobe",
        "image": "public.ecr.aws/docker/library/python:3.12-slim",
        "essential": True,
        "entryPoint": ["python", "-c"],
        "command": [probe],
        "logConfiguration": {"logDriver": "awslogs", "options": {
            "awslogs-group": f"/pegasus/{env}/tenant-runner",
            "awslogs-region": "us-east-1",
            "awslogs-stream-prefix": "dnsprobe"}},
    }],
}))
PY

rev_arn=$(timeout 60 aws ecs register-task-definition "${P[@]}" --cli-input-json "file://$taskdef" \
  --query 'taskDefinition.taskDefinitionArn' --output text) || { echo "register failed" >&2; exit 1; }
echo "registered $rev_arn"
trap 'rm -f "$taskdef"; timeout 60 aws ecs deregister-task-definition "${P[@]}" --task-definition "$rev_arn" --query taskDefinition.status --output text | sed "s/^/deregistered: /"' EXIT

task=$(timeout 60 aws ecs run-task "${P[@]}" --cluster "$cluster" --launch-type FARGATE \
  --task-definition "$rev_arn" --started-by dnsprobe \
  --network-configuration "awsvpcConfiguration={subnets=[${subnets}],securityGroups=[${sg}],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text) || { echo "run-task failed" >&2; exit 1; }
echo "task $task"
timeout 300 aws ecs wait tasks-stopped "${P[@]}" --cluster "$cluster" --tasks "$task"
timeout 60 aws ecs describe-tasks "${P[@]}" --cluster "$cluster" --tasks "$task" \
  --query 'tasks[0].[lastStatus,stoppedReason,containers[0].exitCode]' --output text
sleep 5
timeout 60 aws logs get-log-events "${P[@]}" --log-group-name "/pegasus/$env/tenant-runner" \
  --log-stream-name "dnsprobe/dnsprobe/${task##*/}" --query 'events[].message' --output text | tr '\t' '\n'
