#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Full-stack deployment for Pegasus
#
# Steps:
#   1. Deploy AdminFrontendStack (infra pass) → provisions CloudFront distribution,
#      captures admin URL so Cognito can register it as an allowed callback URL.
#   2. Deploy CognitoStack  → provisions / updates user pool with admin URL in
#      context so the CloudFront callback is whitelisted (skipped with --skip-cognito)
#   3. Deploy ApiStack      → captures API Gateway URL via --outputs-file
#   4. Write VITE_API_URL to packages/web/.env
#   5. Build the web package (Vite bakes the URL into the bundle)
#   6. Deploy FrontendStack → pushes built assets to S3 + invalidates CloudFront
#   7. Read Cognito config from SSM; write apps/admin/.env
#   8. Build apps/admin (Vite bakes all config into the bundle)
#   9. Deploy AdminFrontendStack (asset pass) → pushes built assets to S3
#
# AdminFrontendStack is deployed twice so the CloudFront URL is known before
# CognitoStack registers it as an allowed callback, and before Vite bakes it
# into the bundle. On subsequent runs step 1 is a fast no-op (infra unchanged).
#
# Usage:
#   ./deploy.sh                  # deploy everything (default)
#   ./deploy.sh --api-only       # deploy ApiStack only (skips all frontends)
#   ./deploy.sh --admin-only     # build + deploy admin frontend only
#   ./deploy.sh --skip-cognito   # skip CognitoStack (useful when pool is stable)
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$REPO_ROOT/packages/infra"
WEB_DIR="$REPO_ROOT/packages/web"
ADMIN_DIR="$REPO_ROOT/apps/admin"
OUTPUTS_FILE="/tmp/pegasus-cdk-outputs.json"
WEB_ENV_FILE="$WEB_DIR/.env"
ADMIN_ENV_FILE="$ADMIN_DIR/.env"

AWS_PROFILE="${AWS_PROFILE:-admin-dev}"
API_ONLY=false
ADMIN_ONLY=false
SKIP_COGNITO=false

for arg in "$@"; do
  [[ "$arg" == "--api-only" ]]     && API_ONLY=true
  [[ "$arg" == "--admin-only" ]]   && ADMIN_ONLY=true
  [[ "$arg" == "--skip-cognito" ]] && SKIP_COGNITO=true
done

echo ""
echo "┌─────────────────────────────────────────────────┐"
echo "│         Pegasus — Full-Stack Deployment          │"
echo "└─────────────────────────────────────────────────┘"
echo ""

cd "$INFRA_DIR"

# ── 1. Deploy AdminFrontendStack — first pass (infra only) ────────────────────
# Must run before CognitoStack so we have the CloudFront URL to pass as context.
# When apps/admin/dist does not exist CDK skips the BucketDeployment, making
# this a pure infra operation (creates bucket + distribution only).
echo "▶  [1/9] Deploying AdminFrontendStack (infra pass)..."
npx cdk deploy PegasusDev-AdminFrontendStack \
  --profile "$AWS_PROFILE" \
  --require-approval never \
  --outputs-file "$OUTPUTS_FILE"

ADMIN_URL=$(jq -r '.["pegasus-dev-admin-frontend"].AdminDistributionUrl // empty' "$OUTPUTS_FILE")
if [[ -z "$ADMIN_URL" ]]; then
  echo "✘  Could not read AdminDistributionUrl from CDK outputs. Aborting."
  exit 1
fi
echo "   Admin URL: $ADMIN_URL"

# ── 2. Deploy CognitoStack ────────────────────────────────────────────────────
# Pass the admin CloudFront URL via CDK context so the app client registers it
# as an allowed OAuth callback/logout URL alongside the localhost dev URL.
if [[ "$API_ONLY" == "false" && "$SKIP_COGNITO" == "false" ]]; then
  echo "▶  [2/9] Deploying CognitoStack (adminUrl=$ADMIN_URL)..."
  npx cdk deploy PegasusDev-CognitoStack \
    --profile "$AWS_PROFILE" \
    --require-approval never \
    --context "adminUrl=$ADMIN_URL"
else
  echo "▶  [2/9] Skipping CognitoStack."
fi

# ── 3. Deploy ApiStack ────────────────────────────────────────────────────────
if [[ "$ADMIN_ONLY" == "false" ]]; then
  echo "▶  [3/9] Deploying ApiStack..."
  npx cdk deploy PegasusDev-ApiStack \
    --profile "$AWS_PROFILE" \
    --require-approval never \
    --outputs-file "$OUTPUTS_FILE"
else
  echo "▶  [3/9] Skipping ApiStack."
  # Still need outputs for env vars — fetch from a prior run if available.
  if [[ ! -f "$OUTPUTS_FILE" ]]; then
    echo "   Outputs file not found; run without --admin-only at least once first."
    exit 1
  fi
fi

# ── 4. Extract API URL and write web/.env ─────────────────────────────────────
echo "▶  [4/9] Extracting API URL from stack outputs..."
API_URL=$(jq -r '.["pegasus-dev-api"].ApiUrl // empty' "$OUTPUTS_FILE")

if [[ -z "$API_URL" ]]; then
  echo "✘  Could not read ApiUrl from CDK outputs. Aborting."
  exit 1
fi
echo "   API URL: $API_URL"

if [[ "$ADMIN_ONLY" == "false" ]]; then
  # Preserve other vars already in .env but always overwrite VITE_API_URL
  if [[ -f "$WEB_ENV_FILE" ]]; then
    sed -i '/^VITE_API_URL=/d' "$WEB_ENV_FILE"
  fi
  echo "VITE_API_URL=$API_URL" >> "$WEB_ENV_FILE"
  echo "   Written VITE_API_URL to packages/web/.env"
fi

if [[ "$API_ONLY" == "true" ]]; then
  echo ""
  echo "✔  --api-only flag set. Skipping web and admin builds."
  exit 0
fi

# ── 5. Build web package ──────────────────────────────────────────────────────
if [[ "$ADMIN_ONLY" == "false" ]]; then
  echo "▶  [5/9] Building web package..."
  cd "$REPO_ROOT"
  npm run build --workspace=packages/web
fi

# ── 6. Deploy FrontendStack ───────────────────────────────────────────────────
if [[ "$ADMIN_ONLY" == "false" ]]; then
  echo "▶  [6/9] Deploying FrontendStack..."
  cd "$INFRA_DIR"
  npx cdk deploy PegasusDev-FrontendStack \
    --profile "$AWS_PROFILE" \
    --require-approval never \
    --outputs-file "$OUTPUTS_FILE"
fi

# ── 7. Read Cognito config from SSM and write apps/admin/.env ─────────────────
echo "▶  [7/9] Reading Cognito config from SSM..."

COGNITO_DOMAIN=$(aws ssm get-parameter \
  --profile "$AWS_PROFILE" \
  --name '/pegasus/admin/cognito-hosted-ui-domain' \
  --query 'Parameter.Value' \
  --output text)

COGNITO_CLIENT_ID=$(aws ssm get-parameter \
  --profile "$AWS_PROFILE" \
  --name '/pegasus/admin/cognito-admin-client-id' \
  --query 'Parameter.Value' \
  --output text)

if [[ -z "$COGNITO_DOMAIN" || -z "$COGNITO_CLIENT_ID" ]]; then
  echo "✘  Could not read Cognito parameters from SSM."
  echo "   Ensure CognitoStack has been deployed at least once."
  exit 1
fi

echo "   Cognito domain:    $COGNITO_DOMAIN"
echo "   Cognito client ID: $COGNITO_CLIENT_ID"

# Rewrite admin .env from scratch (all values are derived — no manual entries)
cat > "$ADMIN_ENV_FILE" <<EOF
VITE_API_URL=$API_URL
VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
VITE_COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
VITE_COGNITO_REDIRECT_URI=${ADMIN_URL}/auth/callback
EOF
echo "   Written apps/admin/.env"

# ── 8. Build apps/admin ───────────────────────────────────────────────────────
echo "▶  [8/9] Building apps/admin..."
cd "$REPO_ROOT"
npm run build --workspace=apps/admin

# ── 9. Deploy AdminFrontendStack — second pass (asset upload) ─────────────────
# apps/admin/dist now exists, so CDK will include the BucketDeployment that
# syncs assets to S3 and invalidates the CloudFront distribution.
echo "▶  [9/9] Deploying AdminFrontendStack (asset pass)..."
cd "$INFRA_DIR"
npx cdk deploy PegasusDev-AdminFrontendStack \
  --profile "$AWS_PROFILE" \
  --require-approval never \
  --outputs-file "$OUTPUTS_FILE"

echo ""
echo "✔  Deployment complete!"
echo ""

DIST_URL=$(jq -r '.["pegasus-dev-frontend"].DistributionUrl // empty' "$OUTPUTS_FILE" 2>/dev/null || true)
[[ -n "$DIST_URL" ]]  && echo "   Tenant frontend: $DIST_URL"
[[ -n "$ADMIN_URL" ]] && echo "   Admin portal:    $ADMIN_URL"
echo "   API:             $API_URL"
echo ""
