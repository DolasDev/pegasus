#!/usr/bin/env node
/**
 * Guided interactive script to create a PLATFORM_ADMIN user in Cognito and
 * enroll their TOTP MFA device — all in a single guided session.
 *
 * Usage:
 *   npx tsx scripts/create-admin-user.ts
 *
 * Prerequisites:
 *   - AWS credentials configured (profile or environment variables).
 *   - The CDK CognitoStack must be deployed (pegasus-dev-cognito).
 *   - Node >= 18.
 *
 * Optional environment variables (avoids interactive prompts for those fields):
 *   PEGASUS_COGNITO_POOL_ID      — Cognito User Pool ID (e.g. us-east-1_XXXXXXXXX)
 *   PEGASUS_COGNITO_CLIENT_ID    — Admin app client ID
 *   AWS_REGION / AWS_DEFAULT_REGION — AWS region (default: us-east-1)
 *   AWS_PROFILE                  — Named profile from ~/.aws/config (skips profile prompt)
 *
 * MFA enrolment order (prevents the pre-auth trigger blocking setup):
 *   1. AdminCreateUser
 *   2. AdminSetUserPassword (permanent — moves status to CONFIRMED)
 *   3. AdminInitiateAuth  ← user is NOT in PLATFORM_ADMIN yet → trigger passes
 *   4. AssociateSoftwareToken → display TOTP secret
 *   5. VerifySoftwareToken    ← retry loop until correct code
 *   6. AdminSetUserMFAPreference (enable + prefer TOTP)
 *   7. AdminAddUserToGroup (PLATFORM_ADMIN) ← grant admin status last
 */

import crypto from 'crypto'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline/promises'
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminInitiateAuthCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  AdminSetUserMFAPreferenceCommand,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider'
import { fromIni } from '@aws-sdk/credential-providers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const ok = (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`)
const fail = (msg: string) => console.error(`  ${RED}✗${RESET} ${msg}`)
const warn = (msg: string) => console.log(`  ${YELLOW}!${RESET} ${msg}`)
const step = (n: number, total: number, msg: string) =>
  console.log(`\n${BOLD}[STEP ${n}/${total}]${RESET} ${msg}`)

function generatePassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const digits = '0123456789'
  const symbols = '!@#$%^&*'
  const all = upper + lower + digits + symbols

  // Guarantee at least one character from each required class.
  const required = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ]

  const rest = Array.from({ length: 12 }, () => all[crypto.randomInt(all.length)])

  // Fisher-Yates shuffle.
  const chars = [...required, ...rest]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function listAwsProfiles(): string[] {
  const profiles = new Set<string>()

  // ~/.aws/config: section headers are [default] or [profile NAME]; anything else
  // (e.g. [sso-session NAME], [services NAME]) is not a usable credential profile.
  const configPath = process.env['AWS_CONFIG_FILE'] ?? join(homedir(), '.aws', 'config')
  try {
    for (const line of readFileSync(configPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*\[(default|profile\s+[^\]]+)\]\s*$/)
      if (!m?.[1]) continue
      profiles.add(m[1] === 'default' ? 'default' : m[1].replace(/^profile\s+/, '').trim())
    }
  } catch {
    /* file may not exist — that's OK */
  }

  // ~/.aws/credentials: every section header is a profile name verbatim.
  const credsPath =
    process.env['AWS_SHARED_CREDENTIALS_FILE'] ?? join(homedir(), '.aws', 'credentials')
  try {
    for (const line of readFileSync(credsPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*\[([^\]]+)\]\s*$/)
      if (m?.[1]) profiles.add(m[1].trim())
    }
  } catch {
    /* file may not exist — that's OK */
  }

  return [...profiles].sort()
}

function buildTotpUri(secret: string, email: string): string {
  const issuer = encodeURIComponent('Pegasus Admin')
  const account = encodeURIComponent(email)
  return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`
${BOLD}╔══════════════════════════════════════════════════╗
║     Pegasus — Admin User Setup (guided)          ║
╚══════════════════════════════════════════════════╝${RESET}

This script will:
  1. Create a Cognito user for the provided email
  2. Set a strong auto-generated permanent password
  3. Enroll a TOTP authenticator app (you will need one ready)
  4. Grant PLATFORM_ADMIN privileges

Prerequisites:
  • An AWS named profile in ~/.aws/config (run ${BOLD}aws sso login --profile <name>${RESET}
    first if it uses SSO; you'll be prompted to pick one below)
  • CDK stack deployed: ${BOLD}pegasus-dev-cognito${RESET}
  • An authenticator app ready (Google Authenticator, Authy, 1Password, etc.)
`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  try {
    const TOTAL_STEPS = 8

    // -----------------------------------------------------------------------
    // STEP 1 — Resolve AWS credentials (named profile from ~/.aws/config)
    // -----------------------------------------------------------------------
    step(1, TOTAL_STEPS, 'Resolve AWS credentials')

    const region = process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? 'us-east-1'

    const profiles = listAwsProfiles()
    const envProfile = process.env['AWS_PROFILE']?.trim()
    let profile: string

    if (envProfile) {
      profile = envProfile
      ok(`AWS profile (from AWS_PROFILE): ${profile}`)
    } else {
      if (profiles.length > 0) {
        console.log(`  Available profiles in ~/.aws/config:`)
        for (const p of profiles) console.log(`    • ${p}`)
      } else {
        warn('No profiles found in ~/.aws/config — falling back to "default".')
      }
      const answer = (await rl.question('\n  AWS profile to use (blank for "default"): ')).trim()
      profile = answer || 'default'
    }

    const credentials = fromIni({ profile })

    // Resolve once up-front so we fail fast with a clear hint if SSO/creds are stale.
    try {
      await credentials()
      ok(`Credentials resolved for profile: ${profile}`)
    } catch (err) {
      fail(
        `Could not resolve AWS credentials for profile "${profile}": ${err instanceof Error ? err.message : String(err)}`,
      )
      console.log(
        `\n  If this profile uses AWS SSO, refresh your session:`,
        `\n    ${BOLD}aws sso login --profile ${profile}${RESET}`,
        `\n  Then re-run this script.`,
      )
      process.exit(1)
    }

    // -----------------------------------------------------------------------
    // STEP 2 — Resolve Cognito config
    // -----------------------------------------------------------------------
    step(2, TOTAL_STEPS, 'Resolve Cognito configuration')

    let poolId = process.env['PEGASUS_COGNITO_POOL_ID'] ?? ''
    let clientId = process.env['PEGASUS_COGNITO_CLIENT_ID'] ?? ''

    if (poolId) {
      ok(`User Pool ID (from env): ${poolId}`)
    } else {
      console.log(
        `  Find the pool ID in AWS CloudFormation → stack ${BOLD}pegasus-dev-cognito${RESET}`,
        `→ Outputs → ${BOLD}UserPoolId${RESET}`,
        `\n  Or: aws cloudformation describe-stacks --stack-name pegasus-dev-cognito`,
        `--query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text`,
      )
      poolId = (await rl.question('\n  User Pool ID: ')).trim()
    }

    if (clientId) {
      ok(`Admin Client ID (from env): ${clientId}`)
    } else {
      console.log(
        `  Find the client ID in AWS CloudFormation → stack ${BOLD}pegasus-dev-cognito${RESET}`,
        `→ Outputs → ${BOLD}AdminClientId${RESET}`,
      )
      clientId = (await rl.question('\n  Admin App Client ID: ')).trim()
    }

    if (!poolId || !clientId) {
      fail('Both User Pool ID and Admin Client ID are required.')
      process.exit(1)
    }

    const cognito = new CognitoIdentityProviderClient({ region, credentials })
    ok(`Region: ${region}`)

    // -----------------------------------------------------------------------
    // STEP 3 — Collect admin email
    // -----------------------------------------------------------------------
    step(3, TOTAL_STEPS, 'Admin user details')

    const email = (await rl.question('  Admin email address: ')).trim().toLowerCase()
    if (!email.includes('@')) {
      fail('Invalid email address.')
      process.exit(1)
    }

    // -----------------------------------------------------------------------
    // STEP 4 — Create Cognito user
    // -----------------------------------------------------------------------
    step(4, TOTAL_STEPS, 'Create Cognito user')

    const password = generatePassword()

    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        // Suppress the Cognito welcome email — the operator controls credentials.
        MessageAction: 'SUPPRESS',
        TemporaryPassword: password,
      }),
    )
    ok(`User created: ${email}`)

    // -----------------------------------------------------------------------
    // STEP 5 — Set permanent password (moves status FORCE_CHANGE_PASSWORD → CONFIRMED)
    // -----------------------------------------------------------------------
    step(5, TOTAL_STEPS, 'Set permanent password')

    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: poolId,
        Username: email,
        Password: password,
        Permanent: true,
      }),
    )
    ok('Permanent password set')

    // -----------------------------------------------------------------------
    // STEP 6 — Enroll TOTP MFA
    //
    // IMPORTANT: The user is NOT yet in PLATFORM_ADMIN. This allows the
    // pre-auth Lambda trigger to pass (no admin → no MFA check). TOTP is
    // enrolled first; only after successful verification is admin status granted.
    // -----------------------------------------------------------------------
    step(6, TOTAL_STEPS, 'Enroll TOTP MFA')

    console.log('  Opening an auth session to associate a TOTP device…')

    const authResult = await cognito.send(
      new AdminInitiateAuthCommand({
        UserPoolId: poolId,
        ClientId: clientId,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    )

    const tokens = authResult.AuthenticationResult as AuthenticationResultType
    if (!tokens?.AccessToken) {
      fail(`Unexpected auth challenge: ${authResult.ChallengeName ?? 'unknown'}`)
      fail(
        'The user may already have MFA enrolled or the auth flow was not ADMIN_USER_PASSWORD_AUTH.',
      )
      process.exit(1)
    }
    ok('Auth session opened')

    const assoc = await cognito.send(
      new AssociateSoftwareTokenCommand({ AccessToken: tokens.AccessToken }),
    )
    const secretCode = assoc.SecretCode
    if (!secretCode) {
      fail('Failed to retrieve TOTP secret from Cognito.')
      process.exit(1)
    }
    ok('TOTP secret generated')

    const totpUri = buildTotpUri(secretCode, email)

    console.log(`
  ${BOLD}── Add to your authenticator app ──────────────────────${RESET}

  Open your authenticator app and add this account ${BOLD}manually${RESET}:

    Account name : Pegasus Admin (${email})
    Secret key   : ${BOLD}${secretCode}${RESET}
    Type         : Time-based (TOTP)
    Algorithm    : SHA1
    Digits       : 6
    Period       : 30 seconds

  Or paste this URI directly into an app that supports it (1Password, etc.):

    ${totpUri}

  ${BOLD}────────────────────────────────────────────────────────${RESET}
`)

    // Retry loop — let the operator try as many times as needed.
    let verified = false
    while (!verified) {
      const code = (await rl.question('  Enter the 6-digit code from your app: ')).trim()

      try {
        await cognito.send(
          new VerifySoftwareTokenCommand({
            AccessToken: tokens.AccessToken,
            UserCode: code,
            FriendlyDeviceName: 'Admin TOTP',
          }),
        )
        verified = true
      } catch (err) {
        if (err instanceof Error && err.name === 'EnableSoftwareTokenMFAException') {
          fail('Incorrect code — please wait for the next 30-second window and try again.')
        } else {
          throw err
        }
      }
    }
    ok('TOTP code verified')

    await cognito.send(
      new AdminSetUserMFAPreferenceCommand({
        UserPoolId: poolId,
        Username: email,
        SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
      }),
    )
    ok('TOTP set as preferred MFA')

    // -----------------------------------------------------------------------
    // STEP 7 — Grant PLATFORM_ADMIN (after MFA is enrolled and verified)
    // -----------------------------------------------------------------------
    step(7, TOTAL_STEPS, 'Grant PLATFORM_ADMIN group membership')

    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: poolId,
        Username: email,
        GroupName: 'PLATFORM_ADMIN',
      }),
    )
    ok('Added to PLATFORM_ADMIN group')

    // -----------------------------------------------------------------------
    // STEP 8 — Summary
    // -----------------------------------------------------------------------
    step(8, TOTAL_STEPS, 'Setup complete')

    console.log(`
${GREEN}${BOLD}  Admin user ready!${RESET}

  Email    : ${email}
  Password : ${BOLD}${password}${RESET}
  MFA      : TOTP enrolled and required

${YELLOW}${BOLD}  IMPORTANT — store these credentials securely now:${RESET}
  • Save the password in your team password manager immediately.
  • This window is the only time the auto-generated password is shown.
  • The user must sign in to the admin portal and confirm MFA is working.

  Next steps:
    1. Copy the password to a secure vault.
    2. Sign into the admin portal using Cognito Hosted UI.
    3. Provide the email and password to the admin user via a secure channel.
`)
  } finally {
    rl.close()
  }
}

main().catch((err: unknown) => {
  console.error(`\n${RED}Fatal error:${RESET}`, err instanceof Error ? err.message : err)
  process.exit(1)
})
