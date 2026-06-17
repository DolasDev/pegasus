import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import { ApiCdnStack } from '../api-cdn-stack'

// AWS-managed "AllViewerExceptHostHeader" origin request policy ID.
const ALL_VIEWER_EXCEPT_HOST_HEADER =
  cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId

// AWS-managed "CachingDisabled" cache policy ID.
const CACHING_DISABLED = cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId

function synth(attachCustomDomain: boolean) {
  const app = new cdk.App()
  const stack = new ApiCdnStack(app, 'TestApiCdn', {
    env: { account: '111111111111', region: 'us-east-1' },
    httpApiId: 'abc123',
    httpApiRegion: 'us-east-1',
    attachCustomDomain,
  })
  return Template.fromStack(stack)
}

describe('ApiCdnStack — origin request policy', () => {
  it('forwards all viewer headers EXCEPT Host to the API Gateway origin', () => {
    // Regression guard. API Gateway's regional execute-api endpoint routes by
    // the api-id in the Host header. If this flips to ALL_VIEWER, CloudFront
    // forwards Host: api.pegasus.dolas.dev and API Gateway 403s every
    // non-preflight request. See api-cdn-stack.ts for the full rationale.
    const template = synth(false)
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          OriginRequestPolicyId: ALL_VIEWER_EXCEPT_HOST_HEADER,
        }),
      }),
    })
  })

  it('disables caching — every request reaches the API origin', () => {
    const template = synth(false)
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          CachePolicyId: CACHING_DISABLED,
        }),
      }),
    })
  })
})

describe('ApiCdnStack — ResponseHeadersPolicy', () => {
  it('wires the ResponseHeadersPolicy to the Distribution defaultBehavior', () => {
    const template = synth(false)
    // Guard: if responseHeadersPolicy is removed from defaultBehavior, the policy
    // still synthesizes and all policy-resource tests pass — this assertion catches
    // the wiring gap by asserting the Distribution references a policy ID.
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ResponseHeadersPolicyId: Match.anyValue(),
        }),
      }),
    })
  })

  it('synthesizes exactly one ResponseHeadersPolicy', () => {
    const template = synth(false)
    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 1)
  })

  it('sets HSTS with a 1-year max-age and includeSubDomains', () => {
    const template = synth(false)
    template.hasResourceProperties(
      'AWS::CloudFront::ResponseHeadersPolicy',
      Match.objectLike({
        ResponseHeadersPolicyConfig: Match.objectLike({
          SecurityHeadersConfig: Match.objectLike({
            StrictTransportSecurity: Match.objectLike({
              AccessControlMaxAgeSec: 31536000,
              IncludeSubdomains: true,
              Override: true,
            }),
          }),
        }),
      }),
    )
  })

  it('sets X-Content-Type-Options: nosniff', () => {
    const template = synth(false)
    template.hasResourceProperties(
      'AWS::CloudFront::ResponseHeadersPolicy',
      Match.objectLike({
        ResponseHeadersPolicyConfig: Match.objectLike({
          SecurityHeadersConfig: Match.objectLike({
            ContentTypeOptions: Match.objectLike({
              Override: true,
            }),
          }),
        }),
      }),
    )
  })

  it('sets X-Frame-Options: DENY', () => {
    const template = synth(false)
    template.hasResourceProperties(
      'AWS::CloudFront::ResponseHeadersPolicy',
      Match.objectLike({
        ResponseHeadersPolicyConfig: Match.objectLike({
          SecurityHeadersConfig: Match.objectLike({
            FrameOptions: Match.objectLike({
              FrameOption: 'DENY',
              Override: true,
            }),
          }),
        }),
      }),
    )
  })

  it('sets Referrer-Policy: strict-origin-when-cross-origin', () => {
    const template = synth(false)
    template.hasResourceProperties(
      'AWS::CloudFront::ResponseHeadersPolicy',
      Match.objectLike({
        ResponseHeadersPolicyConfig: Match.objectLike({
          SecurityHeadersConfig: Match.objectLike({
            ReferrerPolicy: Match.objectLike({
              ReferrerPolicy: 'strict-origin-when-cross-origin',
              Override: true,
            }),
          }),
        }),
      }),
    )
  })

  it('does not add CORS headers (API Gateway handles CORS)', () => {
    const template = synth(false)
    // CorsConfig should not be present — CORS headers come from API Gateway origin
    const resources = template.findResources('AWS::CloudFront::ResponseHeadersPolicy')
    const policies = Object.values(resources)
    expect(policies.length).toBeGreaterThan(0)
    for (const policy of policies) {
      const config = policy.Properties?.ResponseHeadersPolicyConfig ?? {}
      expect(config.CorsConfig).toBeUndefined()
    }
  })
})

describe('ApiCdnStack — custom domain', () => {
  it('publishes the distribution domain to SSM when the custom domain is attached', () => {
    const template = synth(true)
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/dolas/pegasus/api/distribution-domain',
    })
  })

  it('does not publish to SSM when the custom domain is not attached (dev)', () => {
    const template = synth(false)
    template.resourceCountIs('AWS::SSM::Parameter', 0)
  })
})
