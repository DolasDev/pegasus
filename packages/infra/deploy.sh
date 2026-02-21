#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Full-stack deployment for Pegasus
#
# Steps:
#   1. Deploy ApiStack  → captures API Gateway URL via --outputs-file
#   2. Write VITE_API_URL to packages/web/.env
#   3. Build the web package (Vite bakes the URL into the bundle)
#   4. Deploy FrontendStack → pushes built assets to S3 + invalidates CloudFront
#
# Usage:
#   ./deploy.sh              # deploy both stacks (default)
#   ./deploy.sh --api-only   # deploy ApiStack only (skips frontend)
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$REPO_ROOT/packages/infra"
WEB_DIR="$REPO_ROOT/packages/web"
OUTPUTS_FILE="/tmp/pegasus-cdk-outputs.json"
WEB_ENV_FILE="$WEB_DIR/.env"

AWS_PROFILE="${AWS_PROFILE:-admin}"
API_ONLY=false
for arg in "$@"; do
  [[ "$arg" == "--api-only" ]] && API_ONLY=true
done

echo ""
echo "┌─────────────────────────────────────────────────┐"
echo "│         Pegasus — Full-Stack Deployment          │"
echo "└─────────────────────────────────────────────────┘"
echo ""

# ── 1. Deploy ApiStack ────────────────────────────────────────────────────────
echo "▶  [1/4] Deploying ApiStack..."
cd "$INFRA_DIR"
npx cdk deploy PegasusDev-ApiStack \
  --profile "$AWS_PROFILE" \
  --require-approval never \
  --outputs-file "$OUTPUTS_FILE"

# ── 2. Extract API URL and write web/.env ─────────────────────────────────────
echo "▶  [2/4] Extracting API URL from stack outputs..."
API_URL=$(jq -r '.["pegasus-dev-api"].ApiUrl' "$OUTPUTS_FILE")

if [[ -z "$API_URL" || "$API_URL" == "null" ]]; then
  echo "✘  Could not read ApiUrl from CDK outputs. Aborting."
  exit 1
fi

echo "   API URL: $API_URL"

# Preserve any other vars already in .env (e.g. DIRECT_URL set manually)
# but always overwrite VITE_API_URL
if [[ -f "$WEB_ENV_FILE" ]]; then
  # Remove existing VITE_API_URL line if present
  sed -i '/^VITE_API_URL=/d' "$WEB_ENV_FILE"
fi

echo "VITE_API_URL=$API_URL" >> "$WEB_ENV_FILE"
echo "   Written VITE_API_URL to packages/web/.env"

if [[ "$API_ONLY" == "true" ]]; then
  echo ""
  echo "✔  --api-only flag set. Skipping web build and frontend deploy."
  exit 0
fi

# ── 3. Build web package ──────────────────────────────────────────────────────
echo "▶  [3/4] Building web package..."
cd "$REPO_ROOT"
npm run build --workspace=packages/web

# ── 4. Deploy FrontendStack ───────────────────────────────────────────────────
echo "▶  [4/4] Deploying FrontendStack..."
cd "$INFRA_DIR"
npx cdk deploy PegasusDev-FrontendStack \
  --profile "$AWS_PROFILE" \
  --require-approval never

echo ""
echo "✔  Deployment complete!"
echo ""
DISTRIBUTION_URL=$(jq -r '.["pegasus-dev-frontend"].DistributionUrl // empty' "$OUTPUTS_FILE" 2>/dev/null || true)
[[ -n "$DISTRIBUTION_URL" ]] && echo "   Frontend: $DISTRIBUTION_URL"
echo "   API:      $API_URL"
echo ""
