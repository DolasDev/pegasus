#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Local/emergency deploy wrapper for Pegasus
#
# CI/CD (.github/workflows/deploy.yml) is the canonical deploy path. This
# script exists for local emergency deploys when CI is unavailable. It shells
# out to `npm run deploy:ci` from packages/infra so both paths run the exact
# same CDK command.
#
# Usage:
#   ./deploy.sh                  # deploy everything (default)
#   ./deploy.sh --api-only       # deploy API + infra stacks only
#   ./deploy.sh --admin-only     # build + deploy admin frontend stacks only
#   ./deploy.sh --dry-run        # print the commands without executing them
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$REPO_ROOT/packages/infra"
OUTPUTS_FILE="/tmp/pegasus-cdk-outputs.json"

cd "$INFRA_DIR"

# Env is dev-by-default but parameterizable so the documented "CI is down"
# emergency path (docs/runbooks/rollback.md scenario 6) is a real command, not
# folklore. STACK_PREFIX mirrors deploy.yml: PegasusDev / PegasusStaging /
# PegasusProd. `deploy:ci` reads `-c env=${ENV_NAME:-dev}`, so exporting
# ENV_NAME below routes CDK to the right account/env.
ENV_NAME="${ENV_NAME:-dev}"
export ENV_NAME
STACK_PREFIX="Pegasus$(tr '[:lower:]' '[:upper:]' <<< "${ENV_NAME:0:1}")${ENV_NAME:1}"

# A non-dev deploy hits staging/prod accounts — demand an explicit, matching
# confirmation and the right AWS profile so nobody nukes prod by reflex.
# A --dry-run only previews (no AWS calls), so it shows the banner but never
# needs CONFIRM_ENV.
if [[ "$ENV_NAME" != "dev" ]]; then
  echo ""
  echo "╔═════════════════════════════════════════════════════════════╗"
  echo "║  ⚠  NON-DEV DEPLOY: ENV_NAME=${ENV_NAME} (stacks: ${STACK_PREFIX}-*)"
  echo "║  This deploys to the ${ENV_NAME} AWS account. CI is the canonical"
  echo "║  path — only do this when GitHub Actions is genuinely down."
  echo "║  Ensure AWS_PROFILE points at the ${ENV_NAME} account."
  echo "║  To proceed, re-run with:  CONFIRM_ENV=${ENV_NAME}"
  echo "╚═════════════════════════════════════════════════════════════╝"
  if [[ " $* " != *" --dry-run "* && "${CONFIRM_ENV:-}" != "$ENV_NAME" ]]; then
    echo "✖  CONFIRM_ENV is not '${ENV_NAME}' — aborting." >&2
    exit 1
  fi
fi

# Default profile suits dev; non-dev deploys must set AWS_PROFILE explicitly.
AWS_PROFILE="${AWS_PROFILE:-admin-dev}"
export AWS_PROFILE

API_ONLY=false
ADMIN_ONLY=false
DRY_RUN=false

for arg in "$@"; do
  [[ "$arg" == "--api-only" ]]   && API_ONLY=true
  [[ "$arg" == "--admin-only" ]] && ADMIN_ONLY=true
  [[ "$arg" == "--dry-run" ]]    && DRY_RUN=true
done

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

echo ""
echo "┌─────────────────────────────────────────────────┐"
echo "│    Pegasus — Local Deploy (CI is canonical)      │"
echo "└─────────────────────────────────────────────────┘"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "  (dry-run mode — no AWS calls or file writes)"
fi
echo ""

# ── 1. Build frontends ────────────────────────────────────────────────────────
if [[ "$API_ONLY" == "false" ]]; then
  if [[ "$ADMIN_ONLY" == "false" ]]; then
    echo "▶  [1/2] Building @pegasus/tenant-web..."
    run npm run build --workspace=@pegasus/tenant-web --prefix "$REPO_ROOT"
  fi
  echo "▶  [1/2] Building @pegasus/admin-web..."
  run npm run build --workspace=@pegasus/admin-web --prefix "$REPO_ROOT"
fi

# ── 2. Resolve TARGET (driven by .github/deploy-manifest.json) ───────────────
# Single source of truth for component→stack mapping (Phase 3.4). This fixes
# the previously documented drift where --api-only was missing ApiCdnStack.
# envConditionalStacks entries whose allowed-env list excludes this env are
# filtered out (e.g. TemporalWorkerStack is staging/prod only, never dev).
MANIFEST="$REPO_ROOT/.github/deploy-manifest.json"
if [[ "$API_ONLY" == "true" ]]; then
  TARGET=$(jq -r --arg prefix "${STACK_PREFIX}" --arg env "$ENV_NAME" '
    . as $doc |
    .components.api.stacks[] |
    . as $s |
    if ($doc.envConditionalStacks[$s] // null) == null or
       (($doc.envConditionalStacks[$s]) | index($env) != null)
    then "\($prefix)-\($s)"
    else empty end
  ' "$MANIFEST" | tr '\n' ' ')
  echo "▶  [2/2] Deploying API stacks..."
elif [[ "$ADMIN_ONLY" == "true" ]]; then
  TARGET=$(jq -r --arg prefix "${STACK_PREFIX}" \
    '(.components["admin-web"].stacks + ["CognitoStack","ApiStack"])[] | "\($prefix)-\(.)"' \
    "$MANIFEST" | tr '\n' ' ')
  echo "▶  [2/2] Deploying admin stacks..."
else
  TARGET="--all"
  echo "▶  [2/2] Deploying all stacks..."
fi

export TARGET
echo "   CDK target: $TARGET"
run npm run deploy:ci

echo ""
echo "✔  Deployment complete!"
echo ""

# ── 3. Print URLs + generate mobile .env.deploy ───────────────────────────────
if [[ "$DRY_RUN" == "false" && -f "$OUTPUTS_FILE" ]]; then
  OUT_PREFIX="pegasus-${ENV_NAME}"
  WEB_URL=$(jq -r ".[\"${OUT_PREFIX}-frontend\"].DistributionUrl // empty" "$OUTPUTS_FILE" 2>/dev/null || true)
  ADMIN_URL=$(jq -r ".[\"${OUT_PREFIX}-admin-frontend\"].AdminDistributionUrl // empty" "$OUTPUTS_FILE" 2>/dev/null || true)
  API_URL=$(jq -r ".[\"${OUT_PREFIX}-api\"].ApiUrl // empty" "$OUTPUTS_FILE" 2>/dev/null || true)

  [[ -n "$WEB_URL" ]]   && echo "   Client app:      $WEB_URL"
  [[ -n "$ADMIN_URL" ]] && echo "   Admin portal:    $ADMIN_URL"
  [[ -n "$API_URL" ]]   && echo "   API:             $API_URL"

  COGNITO_USER_POOL_ID=$(jq -r ".[\"${OUT_PREFIX}-cognito\"].UserPoolId // empty" "$OUTPUTS_FILE" 2>/dev/null || true)
  COGNITO_MOBILE_CLIENT_ID=$(jq -r ".[\"${OUT_PREFIX}-cognito\"].MobileClientId // empty" "$OUTPUTS_FILE" 2>/dev/null || true)
  COGNITO_HOSTED_UI_DOMAIN=$(jq -r ".[\"${OUT_PREFIX}-cognito\"].HostedUiBaseUrl // empty" "$OUTPUTS_FILE" 2>/dev/null || true)

  MOBILE_ENV_FILE="$REPO_ROOT/apps/mobile/.env.deploy"

  # The mobile .env.deploy is a dev convenience — never overwrite it with
  # staging/prod values from an emergency deploy.
  if [[ "$ENV_NAME" == "dev" && -n "$API_URL" && -n "$COGNITO_USER_POOL_ID" && -n "$COGNITO_MOBILE_CLIENT_ID" ]]; then
    cat > "$MOBILE_ENV_FILE" <<ENVEOF
# Generated by deploy.sh — do not edit manually
EXPO_PUBLIC_API_URL=$API_URL
EXPO_PUBLIC_COGNITO_REGION=us-east-1
EXPO_PUBLIC_COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID
EXPO_PUBLIC_COGNITO_CLIENT_ID=$COGNITO_MOBILE_CLIENT_ID
EXPO_PUBLIC_COGNITO_DOMAIN=$COGNITO_HOSTED_UI_DOMAIN
EXPO_PUBLIC_COGNITO_REDIRECT_URI=movingapp://auth/callback
ENVEOF
    echo "   Mobile .env:     $MOBILE_ENV_FILE"
  fi
fi
echo ""
