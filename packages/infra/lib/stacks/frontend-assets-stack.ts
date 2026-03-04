import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import type * as s3 from 'aws-cdk-lib/aws-s3'
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { type Construct } from 'constructs'

export interface FrontendAssetsStackProps extends cdk.StackProps {
  /** S3 bucket from FrontendStack that receives the compiled SPA assets. */
  readonly siteBucket: s3.IBucket
  /** CloudFront distribution from FrontendStack — used for cache invalidation. */
  readonly distribution: cloudfront.IDistribution
  /** API Gateway URL — resolved CDK token from ApiStack. */
  readonly apiUrl: string
  /** AWS region of the Cognito User Pool. Defaults to us-east-1. */
  readonly cognitoRegion?: string
  /** Cognito User Pool ID — resolved CDK token from CognitoStack. */
  readonly cognitoUserPoolId: string
  /** Tenant app client ID — resolved CDK token from CognitoStack. */
  readonly cognitoTenantClientId: string
  /** Cognito Hosted UI base URL — resolved CDK token from CognitoStack. */
  readonly cognitoDomain: string
}

/**
 * FrontendAssetsStack uploads the compiled Pegasus tenant web app to S3 and
 * invalidates the CloudFront distribution.
 *
 * Separated from FrontendStack so that CognitoStack can reference
 * FrontendStack's CloudFront domain as a cross-stack token (which CDK wires
 * via Fn::ImportValue) without creating a circular dependency:
 *
 *   FrontendStack ──► CognitoStack ──► ApiStack ──► FrontendAssetsStack
 *
 * Source.jsonData supports CloudFormation tokens — the BucketDeployment custom
 * resource Lambda receives resolved values at deploy time.
 */
export class FrontendAssetsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendAssetsStackProps) {
    super(scope, id, props)

    const distPath = path.join(__dirname, '../../../../packages/web/dist')
    if (fs.existsSync(distPath)) {
      new s3deploy.BucketDeployment(this, 'DeployWebsite', {
        sources: [
          s3deploy.Source.asset(distPath),
          s3deploy.Source.jsonData('config.json', {
            apiUrl: props.apiUrl,
            cognito: {
              region: props.cognitoRegion ?? 'us-east-1',
              userPoolId: props.cognitoUserPoolId,
              clientId: props.cognitoTenantClientId,
              domain: props.cognitoDomain,
              redirectUri: `https://${props.distribution.distributionDomainName}/login/callback`,
            },
          }),
        ],
        destinationBucket: props.siteBucket,
        distribution: props.distribution,
        distributionPaths: ['/*'],
      })
    }
  }
}
