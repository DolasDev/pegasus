import { describe, it } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { FrontendStack } from '../frontend-stack'

function synthFrontendStack() {
  const app = new cdk.App()
  const stack = new FrontendStack(app, 'TestFrontend')
  return Template.fromStack(stack)
}

describe('FrontendStack — S3 bucket', () => {
  it('creates exactly one S3 bucket', () => {
    const template = synthFrontendStack()
    template.resourceCountIs('AWS::S3::Bucket', 1)
  })

  it('blocks all public access', () => {
    const template = synthFrontendStack()
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })
  })

  it('enables S3-managed server-side encryption', () => {
    const template = synthFrontendStack()
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          }),
        ]),
      },
    })
  })
})

describe('FrontendStack — CloudFront distribution', () => {
  it('creates exactly one CloudFront distribution', () => {
    const template = synthFrontendStack()
    template.resourceCountIs('AWS::CloudFront::Distribution', 1)
  })

  it('sets index.html as the default root object', () => {
    const template = synthFrontendStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
      }),
    })
  })

  it('enforces HTTPS by redirecting HTTP requests', () => {
    const template = synthFrontendStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    })
  })

  it('enables compression on the default cache behavior', () => {
    const template = synthFrontendStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          Compress: true,
        }),
      }),
    })
  })

  it('serves 403 errors as 200 with index.html for SPA routing', () => {
    const template = synthFrontendStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 403,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
        ]),
      }),
    })
  })

  it('serves 404 errors as 200 with index.html for SPA routing', () => {
    const template = synthFrontendStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
        ]),
      }),
    })
  })

  it('enables HTTP/2', () => {
    const template = synthFrontendStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        HttpVersion: 'http2',
      }),
    })
  })
})

describe('FrontendStack — Origin Access Control', () => {
  it('creates an Origin Access Control resource', () => {
    const template = synthFrontendStack()
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1)
  })

  it('configures OAC for S3 origin type', () => {
    const template = synthFrontendStack()
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      }),
    })
  })
})

describe('FrontendStack — CloudFormation Outputs', () => {
  it('exports the CloudFront distribution URL', () => {
    const template = synthFrontendStack()
    template.hasOutput('DistributionUrl', {
      Export: { Name: 'PegasusDistributionUrl' },
    })
  })

  it('exports the CloudFront distribution ID', () => {
    const template = synthFrontendStack()
    template.hasOutput('DistributionId', {
      Export: { Name: 'PegasusDistributionId' },
    })
  })

  it('exports the S3 bucket name', () => {
    const template = synthFrontendStack()
    template.hasOutput('SiteBucketName', {
      Export: { Name: 'PegasusSiteBucketName' },
    })
  })
})
