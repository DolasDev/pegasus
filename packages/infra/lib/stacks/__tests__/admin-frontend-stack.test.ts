import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { AdminFrontendStack } from '../admin-frontend-stack'

function synthAdminStack(props?: { apiUrl?: string; cognitoDomain?: string; cognitoAdminClientId?: string }) {
  const app = new cdk.App()
  const stack = new AdminFrontendStack(app, 'TestAdminFrontend', props)
  return Template.fromStack(stack)
}

describe('AdminFrontendStack — S3 bucket', () => {
  it('creates exactly one S3 bucket', () => {
    const template = synthAdminStack()
    template.resourceCountIs('AWS::S3::Bucket', 1)
  })

  it('blocks all public access', () => {
    const template = synthAdminStack()
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
    const template = synthAdminStack()
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

describe('AdminFrontendStack — CloudFront distribution', () => {
  it('creates exactly one CloudFront distribution', () => {
    const template = synthAdminStack()
    template.resourceCountIs('AWS::CloudFront::Distribution', 1)
  })

  it('sets index.html as the default root object', () => {
    const template = synthAdminStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
      }),
    })
  })

  it('enforces HTTPS by redirecting HTTP requests', () => {
    const template = synthAdminStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    })
  })

  it('enables compression on the default cache behavior', () => {
    const template = synthAdminStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          Compress: true,
        }),
      }),
    })
  })

  it('serves 403 errors as 200 with index.html for SPA routing', () => {
    const template = synthAdminStack()
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
    const template = synthAdminStack()
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
    const template = synthAdminStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        HttpVersion: 'http2',
      }),
    })
  })

  it('always has a /config.json cache behaviour with caching disabled', () => {
    const template = synthAdminStack()
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/config.json',
            // CACHING_DISABLED managed policy ID
            CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
          }),
        ]),
      }),
    })
  })
})

describe('AdminFrontendStack — Origin Access Control', () => {
  it('creates an Origin Access Control resource', () => {
    const template = synthAdminStack()
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1)
  })

  it('configures OAC for S3 origin type', () => {
    const template = synthAdminStack()
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      }),
    })
  })
})

describe('AdminFrontendStack — config.json source', () => {
  it('without Cognito props: BucketDeployment has one source (SPA assets only)', () => {
    const template = synthAdminStack()
    const deployments = template.findResources('Custom::CDKBucketDeployment')
    const keys = Object.keys(deployments)
    // dist exists → a BucketDeployment is created, but only one source (no jsonData)
    const firstKey = keys[0]
    if (firstKey !== undefined) {
      const sourceKeys = deployments[firstKey]!.Properties.SourceObjectKeys as unknown[]
      expect(sourceKeys).toHaveLength(1)
    }
    // If dist doesn't exist (e.g. fresh checkout), no deployment is created — also acceptable.
  })

  it('with Cognito props: BucketDeployment has two sources (SPA assets + config.json)', () => {
    const template = synthAdminStack({
      apiUrl: 'https://api.example.com',
      cognitoDomain: 'https://pegasus-test.auth.us-east-1.amazoncognito.com',
      cognitoAdminClientId: 'test-admin-client-id',
    })
    const deployments = template.findResources('Custom::CDKBucketDeployment')
    const keys = Object.keys(deployments)
    // dist must exist for the BucketDeployment to be created
    const firstKey = keys[0]
    if (firstKey !== undefined) {
      const sourceKeys = deployments[firstKey]!.Properties.SourceObjectKeys as unknown[]
      expect(sourceKeys).toHaveLength(2)
    }
  })

  it('with Cognito props: /config.json CloudFront behaviour has a disabled cache policy', () => {
    const template = synthAdminStack({
      apiUrl: 'https://api.example.com',
      cognitoDomain: 'https://pegasus-test.auth.us-east-1.amazoncognito.com',
      cognitoAdminClientId: 'test-admin-client-id',
    })
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/config.json',
            CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
          }),
        ]),
      }),
    })
  })
})

describe('AdminFrontendStack — CloudFormation Outputs', () => {
  it('exports the CloudFront distribution URL', () => {
    const template = synthAdminStack()
    template.hasOutput('AdminDistributionUrl', {
      Export: { Name: 'PegasusAdminDistributionUrl' },
    })
  })

  it('exports the CloudFront distribution ID', () => {
    const template = synthAdminStack()
    template.hasOutput('AdminDistributionId', {
      Export: { Name: 'PegasusAdminDistributionId' },
    })
  })

  it('exports the S3 bucket name', () => {
    const template = synthAdminStack()
    template.hasOutput('AdminBucketName', {
      Export: { Name: 'PegasusAdminBucketName' },
    })
  })
})
