// ---------------------------------------------------------------------------
// Tests for the app-client identity-provider wiring.
//
// The load-bearing assertion here is field preservation: UpdateUserPoolClient
// replaces the whole client config, so a write that forgets to echo CallbackURLs or
// ExplicitAuthFlows back would break password login for every tenant — a far worse
// outage than the SSO bug this code exists to fix.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import {
  addProviderToAppClient,
  removeProviderFromAppClient,
  reconcileAppClientProviders,
  reconcileAppClientProvidersSafely,
} from './cognito-app-client'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  DescribeUserPoolClientCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { __cmd: 'DescribeUserPoolClient', ...(input as object) }
  }),
  UpdateUserPoolClientCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { __cmd: 'UpdateUserPoolClient', ...(input as object) }
  }),
}))

const POOL = 'us-east-1_TESTPOOL'
const CLIENT = 'tenant-client-id'

/** Mirrors a real DescribeUserPoolClient response, including read-only fields. */
const describedClient = {
  UserPoolId: POOL,
  ClientId: CLIENT,
  ClientName: 'tenant-app-client',
  SupportedIdentityProviders: ['COGNITO'],
  CallbackURLs: ['https://pegasus.example.dev/login/callback'],
  LogoutURLs: ['https://pegasus.example.dev/login'],
  AllowedOAuthFlows: ['code'],
  AllowedOAuthScopes: ['email', 'openid', 'profile'],
  AllowedOAuthFlowsUserPoolClient: true,
  ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_PASSWORD_AUTH'],
  PreventUserExistenceErrors: 'ENABLED',
  EnableTokenRevocation: true,
  AccessTokenValidity: 480,
  IdTokenValidity: 480,
  RefreshTokenValidity: 43200,
  TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'minutes' },
  AuthSessionValidity: 3,
  // Read-only — UpdateUserPoolClient rejects these.
  ClientSecret: 'should-never-be-echoed',
  CreationDate: new Date('2024-01-01T00:00:00Z'),
  LastModifiedDate: new Date('2024-01-02T00:00:00Z'),
}

const cognito = { send: mockSend } as unknown as CognitoIdentityProviderClient

type Cmd = { __cmd: string } & Record<string, unknown>

function sentUpdates(): Cmd[] {
  return mockSend.mock.calls
    .map((c) => c[0] as Cmd)
    .filter((c) => c.__cmd === 'UpdateUserPoolClient')
}

function seedClient(providers: string[]) {
  mockSend.mockImplementation(async (cmd: Cmd) => {
    if (cmd.__cmd === 'DescribeUserPoolClient') {
      return { UserPoolClient: { ...describedClient, SupportedIdentityProviders: providers } }
    }
    return {}
  })
}

describe('cognito-app-client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedClient(['COGNITO'])
  })

  describe('addProviderToAppClient', () => {
    it('appends the provider to the existing list', async () => {
      const wrote = await addProviderToAppClient(cognito, POOL, CLIENT, 'Microsoft')

      expect(wrote).toBe(true)
      expect(sentUpdates()).toHaveLength(1)
      expect(sentUpdates()[0]!['SupportedIdentityProviders']).toEqual(['COGNITO', 'Microsoft'])
    })

    // The whole reason this is a read-modify-write and not a one-field update.
    it('echoes every other field back verbatim', async () => {
      await addProviderToAppClient(cognito, POOL, CLIENT, 'Microsoft')
      const sent = sentUpdates()[0]!

      expect(sent['CallbackURLs']).toEqual(describedClient.CallbackURLs)
      expect(sent['LogoutURLs']).toEqual(describedClient.LogoutURLs)
      expect(sent['ExplicitAuthFlows']).toEqual(describedClient.ExplicitAuthFlows)
      expect(sent['AllowedOAuthFlows']).toEqual(describedClient.AllowedOAuthFlows)
      expect(sent['AllowedOAuthScopes']).toEqual(describedClient.AllowedOAuthScopes)
      expect(sent['AllowedOAuthFlowsUserPoolClient']).toBe(true)
      expect(sent['PreventUserExistenceErrors']).toBe('ENABLED')
      expect(sent['EnableTokenRevocation']).toBe(true)
      expect(sent['AccessTokenValidity']).toBe(480)
      expect(sent['IdTokenValidity']).toBe(480)
      expect(sent['RefreshTokenValidity']).toBe(43200)
      expect(sent['TokenValidityUnits']).toEqual(describedClient.TokenValidityUnits)
      expect(sent['AuthSessionValidity']).toBe(3)
      expect(sent['ClientName']).toBe('tenant-app-client')
    })

    // UpdateUserPoolClient rejects these outright.
    it('strips read-only fields from the update', async () => {
      await addProviderToAppClient(cognito, POOL, CLIENT, 'Microsoft')
      const sent = sentUpdates()[0]!

      expect(sent).not.toHaveProperty('ClientSecret')
      expect(sent).not.toHaveProperty('CreationDate')
      expect(sent).not.toHaveProperty('LastModifiedDate')
    })

    it('does not write when the provider is already listed', async () => {
      seedClient(['COGNITO', 'Microsoft'])

      const wrote = await addProviderToAppClient(cognito, POOL, CLIENT, 'Microsoft')

      expect(wrote).toBe(false)
      expect(sentUpdates()).toHaveLength(0)
    })

    // The pool is shared across tenants — another tenant's provider must survive.
    it('preserves providers belonging to other tenants', async () => {
      seedClient(['COGNITO', 'OtherTenantOkta'])

      await addProviderToAppClient(cognito, POOL, CLIENT, 'Microsoft')

      expect(sentUpdates()[0]!['SupportedIdentityProviders']).toEqual([
        'COGNITO',
        'OtherTenantOkta',
        'Microsoft',
      ])
    })

    it('throws when the app client does not exist', async () => {
      mockSend.mockResolvedValue({})

      await expect(addProviderToAppClient(cognito, POOL, CLIENT, 'Microsoft')).rejects.toThrow(
        /not found/i,
      )
    })
  })

  describe('removeProviderFromAppClient', () => {
    it('removes only the named provider', async () => {
      seedClient(['COGNITO', 'Microsoft', 'OtherTenantOkta'])

      const wrote = await removeProviderFromAppClient(cognito, POOL, CLIENT, 'Microsoft')

      expect(wrote).toBe(true)
      expect(sentUpdates()[0]!['SupportedIdentityProviders']).toEqual([
        'COGNITO',
        'OtherTenantOkta',
      ])
    })

    it('does not write when the provider is not listed', async () => {
      const wrote = await removeProviderFromAppClient(cognito, POOL, CLIENT, 'Microsoft')

      expect(wrote).toBe(false)
      expect(sentUpdates()).toHaveLength(0)
    })

    it('never strips COGNITO, which password login rides on', async () => {
      seedClient(['COGNITO', 'Microsoft'])

      await removeProviderFromAppClient(cognito, POOL, CLIENT, 'Microsoft')

      expect(sentUpdates()[0]!['SupportedIdentityProviders']).toContain('COGNITO')
    })
  })

  describe('reconcileAppClientProviders', () => {
    // The CFN-reset scenario: CDK rewrites the client and the list drops to ['COGNITO'].
    it('repairs a list that CloudFormation reset', async () => {
      seedClient(['COGNITO'])

      const wrote = await reconcileAppClientProviders(cognito, POOL, CLIENT, ['Microsoft'])

      expect(wrote).toBe(true)
      expect(sentUpdates()[0]!['SupportedIdentityProviders']).toEqual(['COGNITO', 'Microsoft'])
    })

    it('does not write when nothing has drifted', async () => {
      seedClient(['COGNITO', 'Microsoft'])

      const wrote = await reconcileAppClientProviders(cognito, POOL, CLIENT, ['Microsoft'])

      expect(wrote).toBe(false)
      expect(sentUpdates()).toHaveLength(0)
    })

    // Only ever adds — other tenants share this pool and this client.
    it('never removes providers it does not know about', async () => {
      seedClient(['COGNITO', 'OtherTenantOkta'])

      await reconcileAppClientProviders(cognito, POOL, CLIENT, ['Microsoft'])

      expect(sentUpdates()[0]!['SupportedIdentityProviders']).toEqual([
        'COGNITO',
        'OtherTenantOkta',
        'Microsoft',
      ])
    })
  })

  describe('reconcileAppClientProvidersSafely', () => {
    it('swallows Cognito failures so the settings page still renders', async () => {
      mockSend.mockRejectedValue(new Error('AccessDeniedException'))

      await expect(
        reconcileAppClientProvidersSafely(cognito, POOL, CLIENT, ['Microsoft']),
      ).resolves.toBeUndefined()
    })

    it('still repairs drift on the happy path', async () => {
      await reconcileAppClientProvidersSafely(cognito, POOL, CLIENT, ['Microsoft'])

      expect(sentUpdates()[0]!['SupportedIdentityProviders']).toEqual(['COGNITO', 'Microsoft'])
    })
  })
})
