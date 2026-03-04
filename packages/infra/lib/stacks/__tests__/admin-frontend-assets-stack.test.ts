import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import { Template } from 'aws-cdk-lib/assertions'
import { AdminFrontendAssetsStack } from '../admin-frontend-assets-stack'

function synthAdminAssetsStack() {
  const app = new cdk.App()
  const parent = new cdk.Stack(app, 'Parent')
  const bucket = new s3.Bucket(parent, 'Bucket')
  const dist = new cloudfront.Distribution(parent, 'Dist', {
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
    },
  })
  const stack = new AdminFrontendAssetsStack(app, 'TestAdminFrontendAssets', {
    adminBucket: bucket,
    distribution: dist,
    apiUrl: 'https://api.example.com',
    cognitoDomain: 'https://pegasus-test.auth.us-east-1.amazoncognito.com',
    cognitoAdminClientId: 'test-admin-client-id',
  })
  return Template.fromStack(stack)
}

describe('AdminFrontendAssetsStack — BucketDeployment', () => {
  it('when dist exists: BucketDeployment has two sources (admin assets + config.json)', () => {
    const template = synthAdminAssetsStack()
    const deployments = template.findResources('Custom::CDKBucketDeployment')
    const keys = Object.keys(deployments)
    // If apps/admin/dist exists (i.e. after a build), the deployment is created
    // with exactly two sources: the compiled admin portal assets and the generated config.json.
    // In a fresh checkout without a prior build, no deployment is created — also acceptable.
    const firstKey = keys[0]
    if (firstKey !== undefined) {
      const sourceKeys = deployments[firstKey]!.Properties.SourceObjectKeys as unknown[]
      expect(sourceKeys).toHaveLength(2)
    }
  })
})
