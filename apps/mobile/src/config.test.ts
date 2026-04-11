import { getMobileConfig, isConfigValid, ConfigError, _resetConfigCache } from './config'

const VALID_ENV: Record<string, string> = {
  EXPO_PUBLIC_API_URL: 'http://localhost:3000',
  EXPO_PUBLIC_COGNITO_REGION: 'us-east-1',
  EXPO_PUBLIC_COGNITO_USER_POOL_ID: 'us-east-1_TestPool123',
  EXPO_PUBLIC_COGNITO_CLIENT_ID: 'test-mobile-client-id',
  EXPO_PUBLIC_COGNITO_DOMAIN: 'https://pegasus-test.auth.us-east-1.amazoncognito.com',
  EXPO_PUBLIC_COGNITO_REDIRECT_URI: 'movingapp://auth/callback',
}

const ENV_KEYS = Object.keys(VALID_ENV)

describe('getMobileConfig', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    _resetConfigCache()
    // Save originals and set valid values
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      process.env[key] = VALID_ENV[key]
    }
  })

  afterEach(() => {
    // Restore originals
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
  })

  it('returns config from EXPO_PUBLIC_* env vars', () => {
    const config = getMobileConfig()

    expect(config).toEqual({
      apiUrl: 'http://localhost:3000',
      cognito: {
        region: 'us-east-1',
        userPoolId: 'us-east-1_TestPool123',
        clientId: 'test-mobile-client-id',
        domain: 'https://pegasus-test.auth.us-east-1.amazoncognito.com',
        redirectUri: 'movingapp://auth/callback',
      },
    })
  })

  it('throws ConfigError when EXPO_PUBLIC_API_URL is missing', () => {
    delete process.env.EXPO_PUBLIC_API_URL

    expect(() => getMobileConfig()).toThrow(ConfigError)
    try {
      getMobileConfig()
    } catch (err) {
      expect((err as ConfigError).code).toBe('MISSING_ENV_VARS')
    }
  })

  it('throws ConfigError when EXPO_PUBLIC_COGNITO_USER_POOL_ID is missing', () => {
    delete process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID

    expect(() => getMobileConfig()).toThrow(ConfigError)
  })

  it('throws ConfigError when EXPO_PUBLIC_COGNITO_CLIENT_ID is missing', () => {
    delete process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID

    expect(() => getMobileConfig()).toThrow(ConfigError)
  })

  it('throws ConfigError when EXPO_PUBLIC_COGNITO_REDIRECT_URI is missing', () => {
    delete process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI

    expect(() => getMobileConfig()).toThrow(ConfigError)
  })

  it('returns domain as null when EXPO_PUBLIC_COGNITO_DOMAIN is empty', () => {
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN = ''

    const config = getMobileConfig()

    expect(config.cognito.domain).toBeNull()
  })

  it('caches result after first successful call', () => {
    const first = getMobileConfig()
    // Change env vars after first call
    process.env.EXPO_PUBLIC_API_URL = 'http://changed:9999'
    const second = getMobileConfig()

    expect(second).toBe(first) // exact same reference
    expect(second.apiUrl).toBe('http://localhost:3000')
  })
})

describe('isConfigValid', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    _resetConfigCache()
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      process.env[key] = VALID_ENV[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
  })

  it('returns true when all env vars are set', () => {
    expect(isConfigValid()).toBe(true)
  })

  it('returns false when required env vars are missing', () => {
    delete process.env.EXPO_PUBLIC_API_URL

    expect(isConfigValid()).toBe(false)
  })
})
