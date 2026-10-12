#!/usr/bin/env bash
# rotate-platform-key.sh — rotate the PLATFORM Temporal key of one env, the key
# in pegasus/<env>/temporal-cloud that the API, reconcile and dispatcher
# Lambdas, the stdlib worker and the tenant runners use. It is the one Temporal
# key that can't rotate itself: CloudFormation bakes it into the Lambdas at
# deploy time and ECS injects it at task start (see scripts/temporal/README.md,
# "Keys that expire"). The daily provisioner run alarms 30 days before it
# expires (pegasus-temporal-key-expiry-platform), reading the secret's
# `expiresAt` TAG, which this script keeps current.
#
#   scripts/temporal/rotate-platform-key.sh <staging|prod>             rotate
#   scripts/temporal/rotate-platform-key.sh <staging|prod> --tag-only  tag only
#
# Rotate:
#   1. Pre-flight: the secret's JSON has an `apiKey` field (key NAMES only are
#      read for this), and the service account pegasus-<env>-service-account
#      and its current key(s) are found in Temporal Cloud (by owner id).
#   2. Mints a 1-year key for that service account.
#   3. PutSecretValue on pegasus/<env>/temporal-cloud, keeping every other JSON
#      field. AWSPREVIOUS keeps the old value.
#   4. Tags the secret expiresAt=<new expiry> and keyId=<new id>.
#   5. PRINTS (doesn't run) the follow-up: redeploy, restart the worker, and
#      only then, at least 24 h later, delete the old key.
#
# --tag-only: sets the expiresAt/keyId tags from the key Temporal Cloud has
# now, and changes nothing else. Use it to seed the tags.
#
# Needs: tcld logged in as an account admin (scripts/temporal/build-tcld.sh,
# then `tcld login`), AWS SSO for profile dolas-pegasus-<env>, jq.
#
# The key is never printed, never on a command line (argv), and only ever
# sits in 0600 files in a private temp dir that is shredded on exit.
set -euo pipefail

E="${1:-}"
MODE="${2:-rotate}"
case "$E" in staging|prod) ;; *) echo "usage: $0 <staging|prod> [--tag-only]" >&2; exit 2 ;; esac
case "$MODE" in rotate|--tag-only) ;; *) echo "usage: $0 <staging|prod> [--tag-only]" >&2; exit 2 ;; esac
TCLD="${PEGASUS_TCLD_HOME:-$HOME/.cache/pegasus-tcld}/bin/tcld"
PROFILE="dolas-pegasus-$E"
REGION=us-east-1
SA_NAME="pegasus-$E-service-account"
SECRET_NAME="pegasus/$E/temporal-cloud"

[ -x "$TCLD" ] || { echo "tcld not found at $TCLD: run scripts/temporal/build-tcld.sh" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

umask 077
WORK="$(mktemp -d)"
cleanup() { find "$WORK" -type f -exec shred -u {} + 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

sm() { aws secretsmanager --profile "$PROFILE" --region "$REGION" "$@"; }

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

tag_secret() { # <expiresAt> <keyId>
  sm tag-resource --secret-id "$SECRET_NAME" \
    --tags "Key=expiresAt,Value=$1" "Key=keyId,Value=$2" >/dev/null
  echo "  tagged $SECRET_NAME: expiresAt=$1 keyId=$2"
}

echo "== Pre-flight ($E)"
aws sts get-caller-identity --profile "$PROFILE" --query Account --output text >/dev/null \
  || { echo "AWS profile $PROFILE is not usable (aws sso login --profile $PROFILE?)" >&2; exit 1; }
sm get-secret-value --secret-id "$SECRET_NAME" --query SecretString --output text >"$WORK/old.json"
FIELDS="$(jq -c 'keys' "$WORK/old.json")" \
  || { echo "$SECRET_NAME is not a JSON object" >&2; exit 1; }
echo "  $SECRET_NAME fields: $FIELDS"
jq -e '.apiKey | type == "string" and length > 0' "$WORK/old.json" >/dev/null \
  || { echo "$SECRET_NAME has no apiKey field. Stopping." >&2; exit 1; }
TAGGED_KEY_ID="$(sm describe-secret --secret-id "$SECRET_NAME" \
  --query "Tags[?Key=='keyId'].Value | [0]" --output text)"
[ "$TAGGED_KEY_ID" = None ] && TAGGED_KEY_ID=""

"$TCLD" service-account list -s 1000 >"$WORK/sas.json"
SA_ID="$(jq -r --arg n "$SA_NAME" '[.. | objects | select(.spec?.name? == $n) | .id] | if length == 1 then .[0] else "" end' "$WORK/sas.json")"
[ -n "$SA_ID" ] || { echo "Expected exactly one service account named $SA_NAME in Temporal Cloud." >&2; exit 1; }
echo "  service account: $SA_NAME ($SA_ID)"

# `apikey list` doesn't show owners; `apikey get` does. Keep the account's keys.
"$TCLD" apikey list >"$WORK/keys.json"
: >"$WORK/owned.jsonl"
for id in $(jq -r '.apiKeys[]?.id' "$WORK/keys.json"); do
  "$TCLD" apikey get -i "$id" \
    | jq -c --arg sa "$SA_ID" 'select(.owner.ownerId == $sa) | {id, name: .spec.displayName, expiresAt: .spec.expiryTime}' \
    >>"$WORK/owned.jsonl"
done
[ -s "$WORK/owned.jsonl" ] || { echo "No API keys found on $SA_NAME." >&2; exit 1; }
echo "  its keys:"
jq -r '"    \(.id)  \(.name)  expires \(.expiresAt)"' "$WORK/owned.jsonl"

# The key in use: the one the tag names; else the only one; else, like the
# provisioner does for its own key, the soonest-expiring (at worst an early
# reminder, never a late one).
if [ -n "$TAGGED_KEY_ID" ] && jq -e --arg id "$TAGGED_KEY_ID" 'select(.id == $id)' "$WORK/owned.jsonl" >/dev/null; then
  CURRENT="$(jq -c --arg id "$TAGGED_KEY_ID" 'select(.id == $id)' "$WORK/owned.jsonl")"
else
  [ "$(wc -l <"$WORK/owned.jsonl")" -gt 1 ] \
    && echo "  (several keys and none tagged as current: assuming the soonest-expiring)"
  CURRENT="$(jq -sc 'sort_by(.expiresAt) | .[0]' "$WORK/owned.jsonl")"
fi
OLD_ID="$(jq -r '.id' <<<"$CURRENT")"
OLD_EXPIRY="$(jq -r '.expiresAt' <<<"$CURRENT")"
echo "  current key: $OLD_ID (expires $OLD_EXPIRY)"

if [ "$MODE" = --tag-only ]; then
  echo "== Tag only"
  tag_secret "$OLD_EXPIRY" "$OLD_ID"
  echo
  echo "Done ($E): the platform-key gauge reads $OLD_EXPIRY from the next daily run."
  exit 0
fi

KEY_NAME="pegasus-$E-api-key-$(date -u +%Y%m%d)"
echo "== 1/3 API key $KEY_NAME (1 year) for $SA_NAME"
"$TCLD" apikey create -n "$KEY_NAME" -d 1y --si "$SA_ID" \
  --desc "Pegasus $E platform key (API, worker, runners)" >"$WORK/key.json"
NEW_ID="$(jq -r '.apiKeyId // .id' "$WORK/key.json")"
jq -e '.secretKey | type == "string" and length > 0' "$WORK/key.json" >/dev/null \
  || { echo "no secretKey in tcld output (key id: $NEW_ID). Delete it: tcld apikey delete -i $NEW_ID" >&2; exit 1; }
echo "  api key id: $NEW_ID"
wait_request "$(jq -r '.requestStatus.requestId' "$WORK/key.json")"
NEW_EXPIRY="$("$TCLD" apikey get -i "$NEW_ID" | jq -r '.spec.expiryTime')"

echo "== 2/3 PutSecretValue $SECRET_NAME ($PROFILE)"
jq --slurpfile k "$WORK/key.json" '.apiKey = $k[0].secretKey' "$WORK/old.json" >"$WORK/new.json"
sm put-secret-value --secret-id "$SECRET_NAME" --secret-string "file://$WORK/new.json" >/dev/null
echo "  stored (the old value stays as AWSPREVIOUS)"

echo "== 3/3 Tags"
tag_secret "$NEW_EXPIRY" "$NEW_ID"

cat <<EOF

Done ($E): $SECRET_NAME now holds key $NEW_ID (expires $NEW_EXPIRY).
Nothing uses it yet. Finish the rotation, in order:

  1. Redeploy the API stack (it bakes the key into the API, reconcile and
     dispatcher Lambdas): GitHub → Actions → Deploy → Run workflow, target = api.
     That deploys staging, then prod; the other env re-deploys with its own
     unchanged key.
  2. Restart the stdlib worker so its tasks re-read the secret:
       aws ecs update-service --profile $PROFILE --region $REGION \\
         --cluster pegasus-temporal-worker-$E --service pegasus-temporal-worker-$E \\
         --force-new-deployment
  3. Tenant runners are scale-to-zero: they pick the key up at their next start.
  4. No sooner than 24 h after steps 1-2 (once no runner can still hold the old
     key), delete the old key:
       tcld apikey delete -i $OLD_ID

Rollback before step 4: the old key still works. Restore it with
  aws secretsmanager update-secret-version-stage ... (AWSPREVIOUS → AWSCURRENT),
re-tag with --tag-only, and redeploy.
EOF
