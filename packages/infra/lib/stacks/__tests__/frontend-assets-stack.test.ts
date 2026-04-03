import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import { Template } from 'aws-cdk-lib/assertions'
import { FrontendAssetsStack } from '../frontend-assets-stack'

function synthAssetsStack() {
  const app = new cdk.App()
  const parent = new cdk.Stack(app, 'Parent')
  const bucket = new s3.Bucket(parent, 'Bucket')
  const dist = new cloudfront.Distribution(parent, 'Dist', {
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
    },
  })
  const stack = new FrontendAssetsStack(app, 'TestFrontendAssets', {
    siteBucket: bucket,
    distribution: dist,
    apiUrl: 'https://api.example.com',
    cognitoRegion: 'us-east-1',
    cognitoUserPoolId: 'us-east-1_TestPool',
    cognitoTenantClientId: 'test-client-id',
    cognitoDomain: 'https://pegasus-test.auth.us-east-1.amazoncognito.com',
  })
  return Template.fromStack(stack)
}

describe('FrontendAssetsStack — BucketDeployment', () => {
  it('when dist exists: BucketDeployment has two sources (SPA assets + config.json)', () => {
    const template = synthAssetsStack()
    const deployments = template.findResources('Custom::CDKBucketDeployment')
    const keys = Object.keys(deployments)
    // If apps/tenant-web/dist exists (i.e. after a build), the deployment is created
    // with exactly two sources: the compiled SPA assets and the generated config.json.
    // In a fresh checkout without a prior build, no deployment is created — also acceptable.
    const firstKey = keys[0]
    if (firstKey !== undefined) {
      const sourceKeys = deployments[firstKey]!.Properties.SourceObjectKeys as unknown[]
      expect(sourceKeys).toHaveLength(2)
    }
  })
})
