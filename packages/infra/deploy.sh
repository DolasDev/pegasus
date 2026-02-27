#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Full-stack deployment for Pegasus
#
# Steps:
#   1. Build both frontends (build once — no env vars baked in)
#   2. Deploy AdminFrontendStack (infra pass) → provisions CloudFront distribution,
#      captures admin URL so Cognito can register it as an allowed callback URL.
#   3. Deploy CognitoStack  → provisions / updates user pool with admin URL in
#      context so the CloudFront callback is whitelisted (skipped with --skip-cognito)
#   4. Deploy ApiStack      → captures API Gateway URL via --outputs-file
#   5. Deploy FrontendStack → CDK generates /config.json in the S3 bucket
#   6. Deploy AdminFrontendStack (asset pass) → CDK uploads assets + /config.json
#
# AdminFrontendStack is deployed twice so the CloudFront URL is known before
# CognitoStack registers it as an allowed callback. On subsequent runs step 2
# is a fast no-op (infra unchanged).
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

echo ""
echo "┌─────────────────────────────────────────────────┐"
echo "│         Pegasus — Full-Stack Deployment          │"
echo "└─────────────────────────────────────────────────┘"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "  (dry-run mode — no AWS calls or file writes)"
fi
echo ""

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

# ── 2. Deploy AdminFrontendStack — first pass (infra only) ────────────────────
# Must run before CognitoStack so we have the CloudFront URL to pass as context.
echo "▶  [2/6] Deploying AdminFrontendStack (infra pass)..."
run npx cdk deploy PegasusDev-AdminFrontendStack \
  --profile "$AWS_PROFILE" \
  --require-approval never \
  --outputs-file "$OUTPUTS_FILE" \
  --app "npx tsx bin/app.ts"

if [[ "$DRY_RUN" == "false" ]]; then
  ADMIN_URL=$(jq -r '.["pegasus-dev-admin-frontend"].AdminDistributionUrl // empty' "$OUTPUTS_FILE")
  echo "ADMIN_URL is: ${ADMIN_URL}"
  if [[ -z "$ADMIN_URL" ]]; then
    echo "✘  Could not read AdminDistributionUrl from CDK outputs. Aborting."
    exit 1
  fi
  echo "   Admin URL: $ADMIN_URL"
else
  ADMIN_URL="https://dry-run-admin.cloudfront.net"
fi

# ── 3. Deploy CognitoStack ────────────────────────────────────────────────────
# Pass the admin CloudFront URL via CDK context so the app client registers it
# as an allowed OAuth callback/logout URL alongside the localhost dev URL.
if [[ "$API_ONLY" == "false" && "$SKIP_COGNITO" == "false" ]]; then
  echo "▶  [3/6] Deploying CognitoStack (adminUrl=${ADMIN_URL})..."
  run npx cdk deploy PegasusDev-CognitoStack \
    --region us-east-1 \
    --profile "$AWS_PROFILE" \
    --require-approval never \
    --context "adminUrl=${ADMIN_URL}" \
    --app "npx tsx bin/app.ts"
else
  echo "▶  [3/6] Skipping CognitoStack."
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
else
  echo "▶  [4/6] Skipping ApiStack."
  # Still need outputs for subsequent stacks — fetch from a prior run if available.
  if [[ ! -f "$OUTPUTS_FILE" ]]; then
    echo "   Outputs file not found; run without --admin-only at least once first."
    exit 1
  fi
fi

if [[ "$API_ONLY" == "true" ]]; then
  echo ""
  echo "✔  --api-only flag set. Skipping frontend deployments."
  exit 0
fi

# ── 5. Deploy FrontendStack ───────────────────────────────────────────────────
# CDK resolves the API URL and Cognito outputs into config.json at deploy time.
WEB_URL=""
if [[ "$ADMIN_ONLY" == "false" ]]; then
  echo "▶  [5/6] Deploying FrontendStack..."
  run npx cdk deploy PegasusDev-FrontendStack \
    --profile "$AWS_PROFILE" \
    --require-approval never \
    --context "adminUrl=${ADMIN_URL}" \
    --outputs-file "$OUTPUTS_FILE" \
    --app "npx tsx bin/app.ts"

  # Capture the client URL now — step 6 will overwrite the outputs file.
  if [[ "$DRY_RUN" == "false" ]]; then
    WEB_URL=$(jq -r '.["pegasus-dev-frontend"].DistributionUrl // empty' "$OUTPUTS_FILE" 2>/dev/null || true)
  else
    WEB_URL="https://dry-run-web.cloudfront.net"
  fi
fi

# ── 6. Deploy AdminFrontendStack — second pass (asset + config.json upload) ───
# Read Cognito/API values from the CDK outputs file and pass them as context.
if [[ "$DRY_RUN" == "false" ]]; then
  API_URL=$(jq -r '.["pegasus-dev-api"].ApiUrl // empty' "$OUTPUTS_FILE")
  COGNITO_DOMAIN=$(jq -r '.["pegasus-dev-cognito"].HostedUiBaseUrl // empty' "$OUTPUTS_FILE")
  COGNITO_ADMIN_CLIENT_ID=$(jq -r '.["pegasus-dev-cognito"].AdminClientId // empty' "$OUTPUTS_FILE")

  if [[ -z "$API_URL" || -z "$COGNITO_DOMAIN" || -z "$COGNITO_ADMIN_CLIENT_ID" ]]; then
    echo "✘  Could not read required values from CDK outputs. Aborting."
    echo "   Ensure CognitoStack and ApiStack have been deployed at least once."
    exit 1
  fi
else
  API_URL="https://dry-run-api.execute-api.us-east-1.amazonaws.com"
  COGNITO_DOMAIN="https://pegasus-dry-run.auth.us-east-1.amazoncognito.com"
  COGNITO_ADMIN_CLIENT_ID="dry-run-client-id"
fi

echo "▶  [6/6] Deploying AdminFrontendStack (asset pass, config.json)..."
run npx cdk deploy PegasusDev-AdminFrontendStack \
  --profile "$AWS_PROFILE" \
  --require-approval never \
  --context "adminUrl=${ADMIN_URL}" \
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
