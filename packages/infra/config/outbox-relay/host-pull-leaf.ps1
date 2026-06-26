# =============================================================================
# Pegasus Outbox Relay — leaf-cert pull (on-prem host side of renewal)
#
# The cloud renew Lambda mints a fresh leaf monthly into SSM. This script (run as
# the relay's service account, on a schedule) pulls the current leaf + key and
# atomically swaps them into the relay's .aws dir. The aws_signing_helper reads
# the cert files fresh on every credential_process call, so no service restart is
# needed — the next AWS call uses the new leaf.
#
# Auth: uses the relay's own `pegasus-outbox-relay` profile (Roles Anywhere with
# the CURRENT leaf, still valid since renewal runs with ~11 months of slack).
#
# Pass -Env staging|prod to select the SSM param prefix (defaults to staging).
#
# Install (elevated, once) — daily scheduled task running as the service acct.
# Note the -Env in the argument and the per-env task name:
#   $a = New-ScheduledTaskAction -Execute 'powershell.exe' `
#     -Argument '-NonInteractive -File C:\Services\Pegasus.Outbox.Relay\host-pull-leaf.ps1 -Env prod'
#   $t = New-ScheduledTaskTrigger -Daily -At 3am   # daily is fine; pull is idempotent
#   Register-ScheduledTask -TaskName 'PegasusOutboxRelayLeafPull-prod' -Action $a -Trigger $t `
#     -User '<RelayServiceAccount>' -Password '<pw>' -RunLevel Highest
# =============================================================================

param(
  [ValidateSet('staging', 'prod')]
  [string]$Env = 'staging'
)

$ErrorActionPreference = 'Stop'

# --- Config — SSM param prefix is per-env (see -Env). ---
$AwsDir       = 'C:\Services\Pegasus.Outbox.Relay\.aws'
$Profile      = 'pegasus-outbox-relay'
$Region       = 'us-east-1'
$LeafCertParam = "/pegasus/$Env/outbox-relay-leaf-pem"
$LeafKeyParam  = "/pegasus/$Env/outbox-relay-leaf-key"

$env:AWS_PROFILE = $Profile
$env:AWS_REGION  = $Region

# --- Pull current leaf + key from SSM (join preserves the multi-line PEM) ---
$pem = (aws ssm get-parameter --name $LeafCertParam --query Parameter.Value --output text) -join "`n"
$key = (aws ssm get-parameter --name $LeafKeyParam --with-decryption --query Parameter.Value --output text) -join "`n"

if (-not $pem.Contains('BEGIN CERTIFICATE')) { throw "pulled leaf cert looks invalid" }
if (-not $key.Contains('BEGIN'))            { throw "pulled leaf key looks invalid" }

# --- Write atomically (temp then move), UTF-8 with NO BOM (helper rejects a BOM) ---
$utf8 = New-Object System.Text.UTF8Encoding($false)
$tmpPem = Join-Path $AwsDir 'leaf.pem.tmp'
$tmpKey = Join-Path $AwsDir 'leaf.key.tmp'
[IO.File]::WriteAllText($tmpPem, $pem, $utf8)
[IO.File]::WriteAllText($tmpKey, $key, $utf8)
Move-Item -Force $tmpPem (Join-Path $AwsDir 'leaf.pem')
Move-Item -Force $tmpKey (Join-Path $AwsDir 'leaf.key')

# --- Lock the key down to the service account only ---
icacls (Join-Path $AwsDir 'leaf.key') /inheritance:r /grant:r "$($env:USERNAME):R" | Out-Null

# --- Sanity: confirm the swapped leaf can still assume the role ---
$ident = aws sts get-caller-identity --query Arn --output text
if (-not $ident.Contains('outbox-relay-publish')) { throw "post-swap identity check failed: $ident" }
Write-Output "leaf pulled + swapped OK; identity: $ident"
