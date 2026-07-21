import { describe, it, expect } from 'vitest'
import {
  SSO_ERROR_NO_EMAIL,
  SSO_ERROR_NOT_ROSTERED,
  SSO_ERROR_MARKERS,
  findSsoErrorMarker,
} from '../sso-errors'

describe('findSsoErrorMarker', () => {
  it('finds a marker wrapped in Cognito prose', () => {
    // The shape Cognito actually produced in prod on 2026-07-21 — our message is
    // sandwiched between a prefix and a service-detail suffix, neither of ours.
    const description =
      'PreTokenGeneration failed with error Authentication failed: the identity ' +
      `provider did not return an email address. [${SSO_ERROR_NO_EMAIL}]. ` +
      '(Service: AWSCognitoIdentityProviderInternalService; Status Code: 400; ' +
      'Error Code: UserLambdaValidationException; Request ID: bb596bd8; Proxy: null)'

    expect(findSsoErrorMarker(description)).toBe(SSO_ERROR_NO_EMAIL)
  })

  it('finds a marker regardless of where it appears', () => {
    expect(findSsoErrorMarker(SSO_ERROR_NOT_ROSTERED)).toBe(SSO_ERROR_NOT_ROSTERED)
    expect(findSsoErrorMarker(`prefix ${SSO_ERROR_NOT_ROSTERED}`)).toBe(SSO_ERROR_NOT_ROSTERED)
    expect(findSsoErrorMarker(`${SSO_ERROR_NOT_ROSTERED} suffix`)).toBe(SSO_ERROR_NOT_ROSTERED)
  })

  it('returns null for unrelated Cognito errors', () => {
    expect(
      findSsoErrorMarker('PreTokenGeneration failed with error Your account has been deactivated.'),
    ).toBeNull()
    expect(findSsoErrorMarker('invalid_request')).toBeNull()
  })

  it('returns null for absent descriptions rather than throwing', () => {
    expect(findSsoErrorMarker(null)).toBeNull()
    expect(findSsoErrorMarker(undefined)).toBeNull()
    expect(findSsoErrorMarker('')).toBeNull()
  })

  it('keeps markers distinct so one can never match another', () => {
    for (const marker of SSO_ERROR_MARKERS) {
      const others = SSO_ERROR_MARKERS.filter((m) => m !== marker)
      for (const other of others) {
        expect(marker.includes(other)).toBe(false)
      }
    }
  })
})
