#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Full-stack deployment for Pegasus
#
# Steps:
#   1.  Build both frontends (build once — no env vars baked in)
#   2a. Deploy AdminFrontendStack (infra pass) → provisions CloudFront distribution,
#       captures admin URL so Cognito can register it as an allowed callback URL.
#   2b. Deploy FrontendStack (infra pass) → provisions CloudFront distribution,
#       captures tenant URL so Cognito can register it as an allowed callback URL.
#   3.  Deploy CognitoStack  → provisions / updates user pool with both CloudFront
#       URLs in context so the callbacks are whitelisted (skipped with --skip-cognito)
#   4.  Deploy ApiStack      → captures API Gateway URL
#   5.  Deploy FrontendStack (asset pass) → CDK uploads assets + /config.json
#   6.  Deploy AdminFrontendStack (asset pass) → CDK uploads assets + /config.json
#
# Both frontend stacks are deployed twice so each CloudFront URL is known before
# CognitoStack registers it as an allowed callback. On subsequent runs steps 2a/2b
# are fast no-ops (infra unchanged).
#
# Variable capture strategy:
#   Each stack's key outputs are read into bash variables immediately after that
#   stack is deployed (before subsequent deploys overwrite the outputs file).
#   This avoids relying on CDK to accumulate cross-stack outputs in a single file.
#
# Usage:
#   ./deploy.sh                  # deploy everything (default)
#   ./deploy.sh --dry-run        # print all commands without executing them
#   ./deploy.sh --api-only       # deploy ApiStack only (skips all frontends)
#   ./deploy.sh --admin-only     # build + deploy admin frontend only
#   ./deploy.sh --skip-cognito   # skip CognitoStack (useful when pool is stable)
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$REPO_ROOT/packages/infra"
OUTPUTS_FILE="/tmp/pegasus-cdk-outputs.json"

# All CDK commands run from the infra directory.
cd "$INFRA_DIR"

AWS_PROFILE="${AWS_PROFILE:-admin-dev}"
API_ONLY=false
ADMIN_ONLY=false
SKIP_COGNITO=false
DRY_RUN=false

for arg in "$@"; do
  [[ "$arg" == "--api-only" ]]     && API_ONLY=true
  [[ "$arg" == "--admin-only" ]]   && ADMIN_ONLY=true
  [[ "$arg" == "--skip-cognito" ]] && SKIP_COGNITO=true
  [[ "$arg" == "--dry-run" ]]      && DRY_RUN=true
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

# Read a single output value from a CloudFormation stack via the AWS CLI.
# Used when the CDK outputs file does not contain the required value (e.g. when
# a stack was deployed in a prior run or skipped with a flag).
cfn_output() {
  local stack_name="$1"
  local output_key="$2"
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --profile "$AWS_PROFILE" \
    --region us-east-1 \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text 2>/dev/null || true
}

# Read a single SSM parameter value.
ssm_param() {
  local name="$1"
  aws ssm get-parameter \
    --name "$name" \
    --profile "$AWS_PROFILE" \
    --region us-east-1 \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || true
}

echo ""
echo "┌─────────────────────────────────────────────────┐"
echo "│         Pegasus — Full-Stack Deployment          │"
echo "└─────────────────────────────────────────────────┘"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "  (dry-run mode — no AWS calls or file writes)"
fi
echo ""

# Initialise all key values — populated as stacks are deployed below.
ADMIN_URL=""
TENANT_URL=""
API_URL=""
COGNITO_DOMAIN=""
COGNITO_ADMIN_CLIENT_ID=""
COGNITO_USER_POOL_ID=""
COGNITO_TENANT_CLIENT_ID=""

# ── 1. Build both frontends ───────────────────────────────────────────────────
# Builds happen before any CDK deploy; no URLs are needed at build time.
if [[ "$API_ONLY" == "false" ]]; then
  if [[ "$ADMIN_ONLY" == "false" ]]; then
    echo "▶  [1/6] Building web package..."
    run npm run build --workspace=@pegasus/web --prefix "$REPO_ROOT"
  fi
  echo "▶  [1/6] Building apps/admin..."
  run npm run build --workspace=@pegasus/admin --prefix "$REPO_ROOT"
fi

# ── 2a. Deploy AdminFrontendStack — first pass (infra only) ───────────────────
# Must run before CognitoStack so we have the admin CloudFront URL to pass as context.
echo "▶  [2a/6] Deploying AdminFrontendStack (infra pass)..."
run npx cdk deploy PegasusDev-AdminFrontendStack \
  --profile "$AWS_PROFILE" \
  --require-approval never \
  --outputs-file "$OUTPUTS_FILE" \
  --app "npx tsx bin/app.ts"

if [[ "$DRY_RUN" == "false" ]]; then
  ADMIN_URL=$(jq -r '.["pegasus-dev-admin-frontend"].AdminDistributionUrl // empty' "$OUTPUTS_FILE")
  if [[ -z "$ADMIN_URL" ]]; then
    echo "✘  Could not read AdminDistributionUrl from CDK outputs. Aborting."
    exit 1
  fi
  echo "   Admin URL: $ADMIN_URL"
else
  ADMIN_URL="https://dry-run-admin.cloudfront.net"
fi

# ── 2b. Deploy FrontendStack — first pass (infra only) ────────────────────────
# Must run before CognitoStack so we have the tenant CloudFront URL to register
# as an allowed OAuth callback/logout URL alongside localhost.
if [[ "$API_ONLY" == "false" && "$ADMIN_ONLY" == "false" ]]; then
  echo "▶  [2b/6] Deploying FrontendStack (infra pass)..."
  run npx cdk deploy PegasusDev-FrontendStack \
    --profile "$AWS_PROFILE" \
    --require-approval never \
    --outputs-file "$OUTPUTS_FILE" \
    --app "npx tsx bin/app.ts"

  if [[ "$DRY_RUN" == "false" ]]; then
    TENANT_URL=$(jq -r '.["pegasus-dev-frontend"].DistributionUrl // empty' "$OUTPUTS_FILE")
    if [[ -z "$TENANT_URL" ]]; then
      echo "✘  Could not read DistributionUrl from CDK outputs. Aborting."
      exit 1
    fi
    echo "   Tenant URL: $TENANT_URL"
  else
    TENANT_URL="https://dry-run-web.cloudfront.net"
  fi
else
  echo "▶  [2b/6] Skipping FrontendStack infra pass."
fi

# ── 3. Deploy CognitoStack ────────────────────────────────────────────────────
# Pass both CloudFront URLs via CDK context so both app clients register them
# as allowed OAuth callback/logout URLs alongside the localhost dev URLs.
# Outputs are captured immediately into bash variables before step 4 overwrites
# the outputs file.
if [[ "$API_ONLY" == "false" && "$SKIP_COGNITO" == "false" ]]; then
  COGNITO_CONTEXT="--context adminUrl=${ADMIN_URL}"
  if [[ -n "$TENANT_URL" ]]; then
    COGNITO_CONTEXT="${COGNITO_CONTEXT} --context tenantUrl=${TENANT_URL}"
  fi
  echo "▶  [3/6] Deploying CognitoStack (adminUrl=${ADMIN_URL} tenantUrl=${TENANT_URL})..."
  echo "COGNITO CONTEXT: {$COGNITO_CONTEXT}"  
  # shellcheck disable=SC2086
  run npx cdk deploy PegasusDev-CognitoStack \
    --region us-east-1 \
    --profile "$AWS_PROFILE" \
    --require-approval never \
    $COGNITO_CONTEXT \
    --outputs-file "$OUTPUTS_FILE" \
    --app "npx tsx bin/app.ts"

  # Capture Cognito values immediately — step 4 will overwrite the outputs file.
  if [[ "$DRY_RUN" == "false" ]]; then
    COGNITO_USER_POOL_ID=$(jq -r '.["pegasus-dev-cognito"].UserPoolId // empty' "$OUTPUTS_FILE")
    COGNITO_TENANT_CLIENT_ID=$(jq -r '.["pegasus-dev-cognito"].TenantClientId // empty' "$OUTPUTS_FILE")
    COGNITO_DOMAIN=$(jq -r '.["pegasus-dev-cognito"].HostedUiBaseUrl // empty' "$OUTPUTS_FILE")
    COGNITO_ADMIN_CLIENT_ID=$(jq -r '.["pegasus-dev-cognito"].AdminClientId // empty' "$OUTPUTS_FILE")

    if [[ -z "$COGNITO_USER_POOL_ID" || -z "$COGNITO_TENANT_CLIENT_ID" || -z "$COGNITO_DOMAIN" || -z "$COGNITO_ADMIN_CLIENT_ID" ]]; then
      echo "✘  Could not read Cognito outputs after CognitoStack deploy. Aborting."
      exit 1
    fi
  else
    COGNITO_USER_POOL_ID="us-east-1_DryRunPool"
    COGNITO_TENANT_CLIENT_ID="dry-run-tenant-client-id"
    COGNITO_DOMAIN="https://pegasus-dry-run.auth.us-east-1.amazoncognito.com"
    COGNITO_ADMIN_CLIENT_ID="dry-run-admin-client-id"
  fi
else
  echo "▶  [3/6] Skipping CognitoStack — reading Cognito values from SSM."
  if [[ "$DRY_RUN" == "false" ]]; then
    COGNITO_USER_POOL_ID=$(ssm_param '/pegasus/admin/cognito-user-pool-id')
    COGNITO_TENANT_CLIENT_ID=$(ssm_param '/pegasus/tenant/cognito-client-id')
    COGNITO_DOMAIN=$(ssm_param '/pegasus/admin/cognito-hosted-ui-domain')
    COGNITO_ADMIN_CLIENT_ID=$(ssm_param '/pegasus/admin/cognito-admin-client-id')

    if [[ -z "$COGNITO_USER_POOL_ID" || -z "$COGNITO_TENANT_CLIENT_ID" || -z "$COGNITO_DOMAIN" || -z "$COGNITO_ADMIN_CLIENT_ID" ]]; then
      echo "✘  Could not read Cognito values from SSM. Deploy CognitoStack at least once without --skip-cognito."
      exit 1
    fi
  else
    COGNITO_USER_POOL_ID="us-east-1_DryRunPool"
    COGNITO_TENANT_CLIENT_ID="dry-run-tenant-client-id"
    COGNITO_DOMAIN="https://pegasus-dry-run.auth.us-east-1.amazoncognito.com"
    COGNITO_ADMIN_CLIENT_ID="dry-run-admin-client-id"
  fi
fi

# ── 4. Deploy ApiStack ────────────────────────────────────────────────────────
if [[ "$ADMIN_ONLY" == "false" ]]; then
  echo "▶  [4/6] Deploying ApiStack..."
  run npx cdk deploy PegasusDev-ApiStack \
    --profile "$AWS_PROFILE" \
    --require-approval never \
    --context "adminUrl=${ADMIN_URL}" \
    --outputs-file "$OUTPUTS_FILE" \
    --app "npx tsx bin/app.ts"

  # Capture API URL immediately after deploy.
  if [[ "$DRY_RUN" == "false" ]]; then
    API_URL=$(jq -r '.["pegasus-dev-api"].ApiUrl // empty' "$OUTPUTS_FILE")
    if [[ -z "$API_URL" ]]; then
      echo "✘  Could not read ApiUrl from CDK outputs. Aborting."
      exit 1
    fi
  else
    API_URL="https://dry-run-api.execute-api.us-east-1.amazonaws.com"
  fi
else
  echo "▶  [4/6] Skipping ApiStack — reading API URL from CloudFormation."
  if [[ "$DRY_RUN" == "false" ]]; then
    API_URL=$(cfn_output 'pegasus-dev-api' 'ApiUrl')
    if [[ -z "$API_URL" ]]; then
      echo "✘  Could not read ApiUrl from CloudFormation. Deploy ApiStack at least once without --admin-only."
      exit 1
    fi
  else
    API_URL="https://dry-run-api.execute-api.us-east-1.amazonaws.com"
  fi
fi

if [[ "$API_ONLY" == "true" ]]; then
  echo ""
  echo "✔  --api-only flag set. Skipping frontend deployments."
  exit 0
fi

# ── 5. Deploy FrontendStack — second pass (asset + config.json upload) ────────
WEB_URL=""
if [[ "$ADMIN_ONLY" == "false" ]]; then
  echo "▶  [5/6] Deploying FrontendStack (asset pass, config.json)..."
  run npx cdk deploy PegasusDev-FrontendStack \
    --profile "$AWS_PROFILE" \
    --require-approval never \
    --context "tenantUrl=${TENANT_URL}" \
    --context "apiUrl=${API_URL}" \
    --context "cognitoDomain=${COGNITO_DOMAIN}" \
    --context "cognitoUserPoolId=${COGNITO_USER_POOL_ID}" \
    --context "cognitoTenantClientId=${COGNITO_TENANT_CLIENT_ID}" \
    --outputs-file "$OUTPUTS_FILE" \
    --app "npx tsx bin/app.ts"

  if [[ "$DRY_RUN" == "false" ]]; then
    WEB_URL=$(jq -r '.["pegasus-dev-frontend"].DistributionUrl // empty' "$OUTPUTS_FILE" 2>/dev/null || true)
  else
    WEB_URL="https://dry-run-web.cloudfront.net"
  fi
fi

# ── 6. Deploy AdminFrontendStack — second pass (asset + config.json upload) ───
echo "▶  [6/6] Deploying AdminFrontendStack (asset pass, config.json)..."
run npx cdk deploy PegasusDev-AdminFrontendStack \
  --profile "$AWS_PROFILE" \
  --require-approval never \
  --context "adminUrl=${ADMIN_URL}" \
  --context "tenantUrl=${TENANT_URL}" \
  --context "apiUrl=${API_URL}" \
  --context "cognitoDomain=${COGNITO_DOMAIN}" \
  --context "cognitoAdminClientId=${COGNITO_ADMIN_CLIENT_ID}" \
  --outputs-file "$OUTPUTS_FILE" \
  --app "npx tsx bin/app.ts"

echo ""
echo "✔  Deployment complete!"
echo ""

if [[ "$DRY_RUN" == "false" ]]; then
  [[ -n "$WEB_URL" ]]   && echo "   Client app:      $WEB_URL"
  [[ -n "$ADMIN_URL" ]] && echo "   Admin portal:    $ADMIN_URL"
  echo "   API:             $API_URL"
fi
echo ""
