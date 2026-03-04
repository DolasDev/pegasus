import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import type * as s3 from 'aws-cdk-lib/aws-s3'
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { type Construct } from 'constructs'

export interface AdminFrontendAssetsStackProps extends cdk.StackProps {
  /** S3 bucket from AdminFrontendStack that receives the compiled admin portal assets. */
  readonly adminBucket: s3.IBucket
  /** CloudFront distribution from AdminFrontendStack — used for cache invalidation. */
  readonly distribution: cloudfront.IDistribution
  /** API Gateway URL — resolved CDK token from ApiStack. */
  readonly apiUrl: string
  /** Cognito Hosted UI base URL — resolved CDK token from CognitoStack. */
  readonly cognitoDomain: string
  /** Admin app client ID — resolved CDK token from CognitoStack. */
  readonly cognitoAdminClientId: string
}

/**
 * AdminFrontendAssetsStack uploads the compiled Pegasus admin portal to S3 and
 * invalidates the CloudFront distribution.
 *
 * Separated from AdminFrontendStack so that CognitoStack can reference
 * AdminFrontendStack's CloudFront domain as a cross-stack token without
 * creating a circular dependency.
 *
 *   AdminFrontendStack ──► CognitoStack ──► ApiStack ──► AdminFrontendAssetsStack
 */
export class AdminFrontendAssetsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AdminFrontendAssetsStackProps) {
    super(scope, id, props)

    const distPath = path.join(__dirname, '../../../../apps/admin/dist')
    if (fs.existsSync(distPath)) {
      new s3deploy.BucketDeployment(this, 'DeployAdmin', {
        sources: [
          s3deploy.Source.asset(distPath),
          s3deploy.Source.jsonData('config.json', {
            apiUrl: props.apiUrl,
            cognito: {
              domain: props.cognitoDomain,
              clientId: props.cognitoAdminClientId,
              redirectUri: `https://${props.distribution.distributionDomainName}/auth/callback`,
            },
          }),
        ],
        destinationBucket: props.adminBucket,
        distribution: props.distribution,
        distributionPaths: ['/*'],
      })
    }
  }
}
