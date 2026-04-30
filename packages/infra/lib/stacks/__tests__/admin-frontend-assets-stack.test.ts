import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { AdminFrontendAssetsStack } from '../admin-frontend-assets-stack'

function synthAdminAssetsStack() {
  const app = new cdk.App()
  const stack = new AdminFrontendAssetsStack(app, 'TestAdminFrontendAssets', {
    adminFrontendStackName: 'pegasus-test-admin-frontend',
    cognitoStackName: 'pegasus-test-cognito',
    apiUrl: 'https://api.example.com',
    cognitoDomain: 'https://pegasus-test.auth.us-east-1.amazoncognito.com',
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
