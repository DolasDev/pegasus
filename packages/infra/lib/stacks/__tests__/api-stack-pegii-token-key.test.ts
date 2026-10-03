// The pegII token signing key (cloud identity I1): an asymmetric KMS key the API
// Lambda may only Sign with and read the public key of, published through
// PEGII_TOKEN_KMS_KEY_IDS (+ PEGII_TOKEN_ISSUER when the env has a branded API).

import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { ApiStack } from '../api-stack'

function synth(props: { pegiiTokenIssuer?: string } = {}) {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
  const stack = new ApiStack(app, 'TestApiPegiiTokenKey', {
    env: { account: '111111111111', region: 'us-east-1' },
    ...props,
  })
  return Template.fromStack(stack)
}

function signingKeyLogicalId(template: Template): string {
  const keys = template.findResources('AWS::KMS::Key', {
    Properties: { KeySpec: 'ECC_NIST_P256', KeyUsage: 'SIGN_VERIFY' },
  })
  const ids = Object.keys(keys)
  expect(ids).toHaveLength(1)
  return ids[0]!
}

type Statement = { Action: string | string[]; Resource: unknown }

function statementsOn(template: Template, keyId: string): Statement[] {
  const policies = template.findResources('AWS::IAM::Policy')
  return Object.values(policies).flatMap((p) =>
    ((p.Properties?.PolicyDocument?.Statement ?? []) as Statement[]).filter((s) =>
      JSON.stringify(s.Resource).includes(keyId),
    ),
  )
}

describe('ApiStack — pegII token signing key', () => {
  it('creates one ECC_NIST_P256 SIGN_VERIFY key, retained, without automatic rotation', () => {
    const template = synth()
    const id = signingKeyLogicalId(template)

    const key = template.toJSON().Resources[id]
    expect(key.DeletionPolicy).toBe('Retain')
    expect(key.UpdateReplacePolicy).toBe('Retain')
    expect(key.Properties.EnableKeyRotation).toBeUndefined()
  })

  it('grants the API only kms:Sign + kms:GetPublicKey on it — never encrypt/decrypt', () => {
    const template = synth()
    const id = signingKeyLogicalId(template)

    const actions = statementsOn(template, id).flatMap((s) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    )
    expect(new Set(actions)).toEqual(new Set(['kms:Sign', 'kms:GetPublicKey']))
  })

  it('publishes the key id to the API Lambda, and the issuer only when configured', () => {
    const withIssuer = synth({ pegiiTokenIssuer: 'https://api.pegasus.dolas.dev' })
    const id = signingKeyLogicalId(withIssuer)

    withIssuer.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          PEGII_TOKEN_KMS_KEY_IDS: { Ref: id },
          PEGII_TOKEN_ISSUER: 'https://api.pegasus.dolas.dev',
        }),
      },
    })

    const withoutIssuer = synth()
    const fns = Object.values(withoutIssuer.findResources('AWS::Lambda::Function'))
    expect(
      fns.some((fn) => fn.Properties?.Environment?.Variables?.PEGII_TOKEN_ISSUER !== undefined),
    ).toBe(false)
  })
})
