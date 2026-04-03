export type WebConfig = {
  apiUrl: string
  cognito: {
    region: string
    userPoolId: string
    clientId: string
    /** Hosted UI base URL — trailing slash stripped. */
    domain: string
    redirectUri: string
  }
}

let _config: WebConfig | null = null

/**
 * Fetches /config.json and stores it for subsequent `getConfig()` calls.
 * Must be awaited before rendering the React tree.
 * Throws a descriptive error on fetch failure or missing fields.
 */
export async function loadConfig(): Promise<void> {
  let json: unknown
  try {
    const res = await fetch('/config.json')
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    json = await res.json()
  } catch (err) {
    throw new Error(
      `Failed to load /config.json: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const cfg = json as Record<string, unknown>
  const cognito = cfg['cognito'] as Record<string, unknown> | undefined

  if (
    typeof cfg['apiUrl'] !== 'string' ||
    !cognito ||
    typeof cognito['region'] !== 'string' ||
    typeof cognito['userPoolId'] !== 'string' ||
    typeof cognito['clientId'] !== 'string' ||
    typeof cognito['domain'] !== 'string' ||
    typeof cognito['redirectUri'] !== 'string'
  ) {
    throw new Error(
      'Invalid /config.json: expected { apiUrl, cognito: { region, userPoolId, clientId, domain, redirectUri } }',
    )
  }

  _config = {
    apiUrl: cfg['apiUrl'],
    cognito: {
      region: cognito['region'],
      userPoolId: cognito['userPoolId'],
      clientId: cognito['clientId'],
      domain: (cognito['domain'] as string).replace(/\/$/, ''),
      redirectUri: cognito['redirectUri'],
    },
  }
}

/**
 * Returns the loaded config. Throws if `loadConfig()` has not completed.
 */
export function getConfig(): WebConfig {
  if (!_config) {
    throw new Error('Config not loaded — call loadConfig() before getConfig()')
  }
  return _config
}
