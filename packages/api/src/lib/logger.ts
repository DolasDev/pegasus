import { Logger } from '@aws-lambda-powertools/logger'

/**
 * Creates a named Logger instance. Used by standalone Lambda entry points
 * (Cognito triggers) that cannot share the main app singleton.
 */
export function createLogger(service: string): Logger {
  return new Logger({
    serviceName: service,
    logLevel: (process.env['LOG_LEVEL'] ?? 'INFO') as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  })
}

/** Shared structured logger for the main API Lambda. */
export const logger = createLogger('pegasus-api')
