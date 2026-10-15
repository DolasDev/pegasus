#!/usr/bin/env bash
# create-provisioner.sh — Stage B Step 1 of plans/completed/f0d47ffb-tenant-temporal-namespaces.md:
# create the per-env temporal provisioner identity and store its key.
#
#   scripts/temporal/create-provisioner.sh <staging|prod>
#
# 1. Creates Temporal Cloud service account pegasus-<env>-provisioner with
#    account role Developer (needs a tcld login as Global Admin or Owner).
# 2. Mints a 1-year API key for it.
# 3. Stores {"apiKey": ...} in Secrets Manager as pegasus/<env>/temporal-provisioner
#    (AWS profile dolas-pegasus-<env>, us-east-1) and prints the full ARN.
#
# The key is never printed, never on a command line (argv), and only ever
# sits in 0600 files in a private temp dir that is shredded on exit.
set -euo pipefail

E="${1:-}"
case "$E" in staging|prod) ;; *) echo "usage: $0 <staging|prod>" >&2; exit 2 ;; esac
TCLD="${PEGASUS_TCLD_HOME:-$HOME/.cache/pegasus-tcld}/bin/tcld"
PROFILE="dolas-pegasus-$E"
REGION=us-east-1
SA_NAME="pegasus-$E-provisioner"
KEY_NAME="pegasus-$E-provisioner-key"
SECRET_NAME="pegasus/$E/temporal-provisioner"

[ -x "$TCLD" ] || { echo "tcld not found at $TCLD: run scripts/temporal/build-tcld.sh" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

umask 077
WORK="$(mktemp -d)"
cleanup() { find "$WORK" -type f -exec shred -u {} + 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

wait_request() { # <request id>
  local id="$1" state=""
  for _ in $(seq 1 60); do
    state="$("$TCLD" request get -r "$id" | jq -r '.requestStatus.state')"
    case "$state" in
      Fulfilled) echo "  request $id: Fulfilled"; return 0 ;;
      Failed|Cancelled|Rejected) echo "  request $id: $state" >&2; return 1 ;;
    esac
    sleep 5
  done
  echo "  request $id: still $state after 5 minutes" >&2; return 1
}

echo "== Pre-flight ($E)"
aws sts get-caller-identity --profile "$PROFILE" --query Account --output text >/dev/null \
  || { echo "AWS profile $PROFILE is not usable (aws sso login --profile $PROFILE?)" >&2; exit 1; }
if aws secretsmanager describe-secret --profile "$PROFILE" --region "$REGION" --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
  echo "Secret $SECRET_NAME already exists in $PROFILE. Refusing to overwrite." >&2
  exit 1
fi
"$TCLD" service-account list -s 1000 >"$WORK/sas.json"
if jq -e --arg n "$SA_NAME" '[.. | objects | select(.spec?.name? == $n)] | length > 0' "$WORK/sas.json" >/dev/null; then
  echo "Service account $SA_NAME already exists in Temporal Cloud. Stopping so we don't make a second one." >&2
  echo "If it's from an earlier half-finished run, delete it (tcld sa delete --id <id>) and re-run." >&2
  exit 1
fi

echo "== 1/3 Service account $SA_NAME (role Developer)"
"$TCLD" service-account create -n "$SA_NAME" \
  -d "Creates per-tenant Temporal namespaces (Pegasus 3b, $E)" --ar Developer >"$WORK/sa.json"
SA_ID="$(jq -r '.serviceAccountId' "$WORK/sa.json")"
[ -n "$SA_ID" ] && [ "$SA_ID" != null ] || { echo "no serviceAccountId in tcld output" >&2; exit 1; }
echo "  service account id: $SA_ID"
wait_request "$(jq -r '.requestStatus.requestId' "$WORK/sa.json")"

echo "== 2/3 API key $KEY_NAME (1 year)"
"$TCLD" apikey create -n "$KEY_NAME" -d 1y --si "$SA_ID" \
  --desc "Pegasus $E temporal-provisioner Lambda" >"$WORK/key.json"
KEY_ID="$(jq -r '.apiKeyId // .id' "$WORK/key.json")"
jq -e '.secretKey | type == "string" and length > 0' "$WORK/key.json" >/dev/null \
  || { echo "no secretKey in tcld output (key id: $KEY_ID). Delete it: tcld apikey delete -i $KEY_ID" >&2; exit 1; }
echo "  api key id: $KEY_ID"
wait_request "$(jq -r '.requestStatus.requestId' "$WORK/key.json")"

echo "== 3/3 Secrets Manager $SECRET_NAME ($PROFILE)"
jq '{apiKey: .secretKey}' "$WORK/key.json" >"$WORK/secret.json"
aws secretsmanager create-secret --profile "$PROFILE" --region "$REGION" \
  --name "$SECRET_NAME" \
  --description "Temporal Cloud Ops key for the $E temporal-provisioner Lambda (service account $SA_NAME, key $KEY_ID)" \
  --secret-string "file://$WORK/secret.json" >/dev/null
ARN="$(aws secretsmanager describe-secret --profile "$PROFILE" --region "$REGION" --secret-id "$SECRET_NAME" --query ARN --output text)"

echo
echo "Done ($E)."
echo "  service account: $SA_NAME ($SA_ID)"
echo "  api key id:      $KEY_ID (expires in 1 year)"
echo "  secret ARN:      $ARN"
echo "Record the ARN for TEMPORAL_SECRET_ARNS.$E.temporalProvisioner in packages/infra/bin/app.ts (the enable PR)."
