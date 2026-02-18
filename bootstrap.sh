#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — New developer setup for Move Management Platform
# Run this ONCE on a fresh Ubuntu machine before anything else.
# Safe to re-run — all steps are idempotent.
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${BLUE}ℹ${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
fail() { echo -e "${RED}✘${RESET}  $*"; }
header() { echo -e "\n${BOLD}${BLUE}── $* ${RESET}"; }

# ── Helpers ───────────────────────────────────────────────────────────────────
command_exists() { command -v "$1" &>/dev/null; }

version_gte() {
  # usage: version_gte "actual" "minimum"  e.g. version_gte "20.1.0" "18.0.0"
  printf '%s\n%s\n' "$2" "$1" | sort -C -V
}

require_sudo() {
  if [[ $EUID -ne 0 ]] && ! sudo -n true 2>/dev/null; then
    echo -e "${YELLOW}This script needs sudo for apt installs. You may be prompted for your password.${RESET}"
  fi
}

# =============================================================================
echo ""
echo -e "${BOLD}Move Management Platform — Developer Bootstrap${RESET}"
echo -e "Sets up everything needed to run the Claude Code prompts on Ubuntu."
echo -e "Safe to re-run at any time.\n"
# =============================================================================

require_sudo
ERRORS=0

# ── 1. System packages ────────────────────────────────────────────────────────
header "System packages"
sudo apt-get update -qq
sudo apt-get install -y -qq curl git unzip jq 2>/dev/null
ok "curl, git, unzip, jq installed"

# ── 2. Node.js ────────────────────────────────────────────────────────────────
header "Node.js (required >= 18)"
NODE_MIN="18.0.0"

if command_exists node; then
  NODE_VER=$(node --version | tr -d 'v')
  if version_gte "$NODE_VER" "$NODE_MIN"; then
    ok "Node.js $NODE_VER already installed"
  else
    warn "Node.js $NODE_VER is below minimum $NODE_MIN — upgrading..."
    curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
    sudo -E bash /tmp/nodesource_setup.sh
    sudo apt-get install -y nodejs
    rm -f /tmp/nodesource_setup.sh
    ok "Node.js $(node --version) installed"
  fi
else
  info "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
  sudo -E bash /tmp/nodesource_setup.sh
  sudo apt-get install -y nodejs
  rm -f /tmp/nodesource_setup.sh
  ok "Node.js $(node --version) installed"
fi

# ── 3. npm ────────────────────────────────────────────────────────────────────
header "npm (required >= 9)"
NPM_VER=$(npm --version)
if version_gte "$NPM_VER" "9.0.0"; then
  ok "npm $NPM_VER"
else
  warn "npm $NPM_VER is below minimum 9 — upgrading..."
  sudo npm install -g npm@latest -q
  ok "npm $(npm --version) installed"
fi

# ── 4. AWS CLI ────────────────────────────────────────────────────────────────
header "AWS CLI (required for CDK deploy)"
if command_exists aws; then
  ok "AWS CLI $(aws --version 2>&1 | head -1)"
else
  info "Installing AWS CLI v2..."
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp/awscli
  sudo /tmp/awscli/aws/install
  rm -rf /tmp/awscliv2.zip /tmp/awscli
  ok "AWS CLI $(aws --version 2>&1 | head -1) installed"
fi

# Check AWS credentials
if aws sts get-caller-identity &>/dev/null; then
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  ok "AWS credentials configured — account $ACCOUNT"
else
  warn "AWS credentials not configured."
  echo "     Run: aws configure"
  echo "     You will need an IAM Access Key ID and Secret from the AWS console."
  echo "     Recommended: create an IAM user with AdministratorAccess for bootstrapping."
  ERRORS=$((ERRORS + 1))
fi

# ── 5. AWS CDK CLI ────────────────────────────────────────────────────────────
header "AWS CDK CLI (required >= 2)"
if command_exists cdk; then
  CDK_VER=$(cdk --version | awk '{print $1}')
  ok "AWS CDK $CDK_VER already installed"
else
  info "Installing AWS CDK CLI globally..."
  npm install -g aws-cdk -q
  ok "AWS CDK $(cdk --version | awk '{print $1}') installed"
fi

# CDK bootstrap check
header "CDK Bootstrap"
if aws sts get-caller-identity &>/dev/null; then
  REGION=$(aws configure get region || echo "us-east-1")
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  # Check if bootstrap stack already exists
  if aws cloudformation describe-stacks --stack-name CDKToolkit --region "$REGION" &>/dev/null; then
    ok "CDK already bootstrapped in $ACCOUNT / $REGION"
  else
    info "Running cdk bootstrap for account $ACCOUNT in $REGION..."
    cdk bootstrap "aws://$ACCOUNT/$REGION"
    ok "CDK bootstrapped in $ACCOUNT / $REGION"
  fi
else
  warn "Skipping CDK bootstrap — configure AWS credentials first, then run: cdk bootstrap"
fi

# ── 6. Git ────────────────────────────────────────────────────────────────────
header "Git"
if command_exists git; then
  ok "Git $(git --version | awk '{print $3}')"
else
  sudo apt-get install -y -qq git
  ok "Git $(git --version | awk '{print $3}') installed"
fi

GIT_NAME=$(git config --global user.name || true)
GIT_EMAIL=$(git config --global user.email || true)
if [[ -z "$GIT_NAME" || -z "$GIT_EMAIL" ]]; then
  warn "Git identity not configured."
  echo "     Run:"
  echo '       git config --global user.name "Your Name"'
  echo '       git config --global user.email "you@example.com"'
  ERRORS=$((ERRORS + 1))
else
  ok "Git identity: $GIT_NAME <$GIT_EMAIL>"
fi

# ── 7. Docker (optional) ─────────────────────────────────────────────────────
header "Docker (optional — only needed for offline local Postgres)"
if command_exists docker; then
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
  if docker info &>/dev/null; then
    ok "Docker daemon is running"
  else
    warn "Docker is installed but the daemon is not running. Start it with: sudo systemctl start docker"
  fi
else
  info "Docker not installed. This is OPTIONAL — the default database is Neon (cloud)."
  info "Only install Docker if you need to work offline with a local Postgres."
  info "Install with: sudo apt-get install -y docker.io && sudo systemctl enable --now docker"
  info "Then add yourself to the docker group: sudo usermod -aG docker \$USER"
fi

# ── 8. Neon reminder ─────────────────────────────────────────────────────────
header "Neon (managed Postgres — required before Prompt 3)"
echo -e "   Neon is a cloud service — nothing to install locally."
echo ""
echo -e "   ${BOLD}Before running Prompt 3 you must:${RESET}"
echo -e "   1. Create a free account at ${BLUE}https://neon.tech${RESET}"
echo -e "   2. Create a new project (choose the region closest to your AWS region)"
echo -e "   3. Copy the connection string from the Neon dashboard"
echo -e "   4. Create a second branch called 'test' for test isolation:"
echo -e "      ${BOLD}neonctl branches create --name test --parent main${RESET}"
echo -e "      (install neonctl: npm install -g neonctl)"
echo -e "   5. Paste both connection strings into your .env file"
echo ""
if [[ -f ".env" ]]; then
  if grep -q "ep-xxx" .env 2>/dev/null || ! grep -q "DATABASE_URL" .env 2>/dev/null; then
    warn ".env exists but DATABASE_URL looks like it hasn't been set yet"
    ERRORS=$((ERRORS + 1))
  else
    ok ".env file found with DATABASE_URL set"
  fi
else
  warn ".env not found — run 'make setup' after cloning the repo to create it from .env.example"
fi

# ── 9. Final summary ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}── Summary ──────────────────────────────────────────────────────${RESET}"
echo ""

node --version &>/dev/null      && ok "Node.js     $(node --version)"       || { fail "Node.js     NOT FOUND"; }
npm --version &>/dev/null       && ok "npm         $(npm --version)"         || { fail "npm         NOT FOUND"; }
aws --version &>/dev/null 2>&1  && ok "AWS CLI     $(aws --version 2>&1 | awk '{print $1}')" || { fail "AWS CLI     NOT FOUND"; }
cdk --version &>/dev/null       && ok "CDK         $(cdk --version | awk '{print $1}')" || { fail "CDK         NOT FOUND"; }
git --version &>/dev/null       && ok "Git         $(git --version | awk '{print $3}')" || { fail "Git         NOT FOUND"; }
command_exists docker           && ok "Docker      $(docker --version | awk '{print $3}' | tr -d ',')" || info "Docker      not installed (optional)"

echo ""

if [[ $ERRORS -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}✔ All required tools are installed and configured.${RESET}"
  echo ""
  echo -e "   ${BOLD}Next steps:${RESET}"
  echo -e "   1. Create a Neon account and project at https://neon.tech"
  echo -e "   2. Run Prompt 0 in Claude Code from the repo root"
  echo -e "   3. Edit .env with your Neon connection strings"
  echo -e "   4. Run: make setup"
  echo -e "   5. Then continue with Prompts 1–5"
else
  echo -e "${YELLOW}${BOLD}⚠ $ERRORS item(s) need attention before you proceed (see warnings above).${RESET}"
  echo -e "  Fix the warnings then re-run this script to confirm everything is ready."
fi

echo ""
