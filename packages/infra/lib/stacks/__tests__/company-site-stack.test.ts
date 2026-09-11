import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { CompanySiteStack } from '../company-site-stack'

/**
 * Minimal shapes for the synthesised resources these tests read. `any` is
 * forbidden repo-wide (PATTERNS.md), and `findResources` is typed loosely
 * enough that reading a nested property otherwise needs a cast per access.
 */
interface DistributionResource {
  Properties: {
    DistributionConfig: {
      Aliases?: string[]
      CustomErrorResponses?: {
        ErrorCode: number
        ResponseCode: number
        ResponsePagePath: string
      }[]
    }
  }
}

interface ResponseHeadersPolicyResource {
  Properties: {
    ResponseHeadersPolicyConfig: {
      SecurityHeadersConfig: {
        ContentSecurityPolicy: { ContentSecurityPolicy: string }
      }
    }
  }
}

interface FunctionResource {
  Properties: { FunctionCode: string }
}

function synth(attachCustomDomain = false) {
  const app = new cdk.App()
  const stack = new CompanySiteStack(app, 'TestCompanySite', {
    env: { account: '123456789012', region: 'us-east-1' },
    attachCustomDomain,
  })
  return Template.fromStack(stack)
}

function resourcesOf<T>(template: Template, type: string): T[] {
  return Object.values(template.findResources(type)) as T[]
}

describe('CompanySiteStack — origin bucket', () => {
  it('keeps the origin bucket private', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })
  })

  it('encrypts the bucket with S3-managed keys', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }),
        ]),
      },
    })
  })

  it('retains the bucket when the stack is deleted', () => {
    synth().hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' })
  })
})

describe('CompanySiteStack — distribution', () => {
  it('serves index.html at the root over HTTPS only', () => {
    synth().hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    })
  })

  /**
   * The regression this guards: FrontendStack maps 403/404 → /index.html with
   * a 200 so the SPA router can take over. Copying that here would turn every
   * missing page into a 200, which is how a *missing* deployed page once
   * passed a status-code check. A static site must keep its 404 a 404.
   */
  it('maps missing objects to a real 404, never a 200 rewrite', () => {
    const template = synth()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 403,
            ResponseCode: 404,
            ResponsePagePath: '/404.html',
          }),
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 404,
            ResponsePagePath: '/404.html',
          }),
        ]),
      }),
    })

    const responses = resourcesOf<DistributionResource>(
      template,
      'AWS::CloudFront::Distribution',
    ).flatMap((d) => d.Properties.DistributionConfig.CustomErrorResponses ?? [])
    expect(responses).not.toHaveLength(0)
    for (const response of responses) {
      expect(response.ResponseCode).toBe(404)
      expect(response.ResponsePagePath).not.toBe('/index.html')
    }
  })

  it('enforces a self-only CSP rather than reporting it', () => {
    const template = synth()
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: {
            ContentSecurityPolicy: Match.stringLikeRegexp("default-src 'self'"),
            Override: true,
          },
          StrictTransportSecurity: Match.objectLike({ IncludeSubdomains: true }),
          FrameOptions: { FrameOption: 'DENY', Override: true },
        }),
      }),
    })

    const [policy] = resourcesOf<ResponseHeadersPolicyResource>(
      template,
      'AWS::CloudFront::ResponseHeadersPolicy',
    )
    const csp =
      policy?.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy
        .ContentSecurityPolicy
    expect(csp).toContain("script-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('uploads the site and invalidates the distribution', () => {
    const template = synth()
    template.resourceCountIs('Custom::CDKBucketDeployment', 1)
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      DistributionPaths: ['/*'],
    })
  })

  it('publishes the distribution domain for the dolas-infra alias records', () => {
    synth().hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/dolas/pegasus/company/distribution-domain',
    })
  })
})

describe('CompanySiteStack — custom domain', () => {
  it('claims no aliases and adds no redirect function until the domain is ready', () => {
    const template = synth(false)
    template.resourceCountIs('AWS::CloudFront::Function', 0)
    const [distribution] = resourcesOf<DistributionResource>(
      template,
      'AWS::CloudFront::Distribution',
    )
    expect(distribution?.Properties.DistributionConfig.Aliases).toBeUndefined()
  })

  it('serves apex + www and redirects www to the apex once attached', () => {
    const template = synth(true)
    template.resourceCountIs('AWS::CloudFront::Function', 1)
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: 'viewer-request' }),
          ]),
        }),
      }),
    })

    const [fn] = resourcesOf<FunctionResource>(template, 'AWS::CloudFront::Function')
    expect(fn?.Properties.FunctionCode).toContain('301')

    const [distribution] = resourcesOf<DistributionResource>(
      template,
      'AWS::CloudFront::Distribution',
    )
    expect(distribution?.Properties.DistributionConfig.Aliases).toHaveLength(2)
  })
})
