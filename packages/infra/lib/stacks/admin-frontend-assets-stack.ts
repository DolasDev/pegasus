import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { type Construct } from 'constructs'

export interface AdminFrontendAssetsStackProps extends cdk.StackProps {
  /**
   * Name of the upstream AdminFrontendStack — used to build Fn::ImportValue
   * strings for the bucket and distribution. See frontend-assets-stack.ts for
   * the rationale (decouples this stack from CDK's auto-export logical IDs).
   */
  readonly adminFrontendStackName: string
  /**
   * Name of the upstream CognitoStack — used to build a stable Fn::ImportValue
   * for the admin app client ID. Same drift-immunity rationale as
   * adminFrontendStackName: passing the construct ref directly lets CDK
   * auto-generate the export logical ID, and that ID has empirically drifted
   * across CDK minor versions, blocking cognito-stack updates with
   * "Cannot delete export … as it is in use by …".
   */
  readonly cognitoStackName: string
  /** API Gateway URL — resolved CDK token from ApiStack. */
  readonly apiUrl: string
  /** Cognito Hosted UI base URL — resolved CDK token from CognitoStack. */
  readonly cognitoDomain: string
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

    const adminBucket = s3.Bucket.fromBucketAttributes(this, 'AdminBucketRef', {
      bucketArn: cdk.Fn.importValue(
        `${props.adminFrontendStackName}:ExportsOutputFnGetAttAdminBucketB0A70AB7ArnB4CAD264`,
      ),
      bucketName: cdk.Fn.importValue(
        `${props.adminFrontendStackName}:ExportsOutputRefAdminBucketB0A70AB74CDEAEE9`,
      ),
    })

    const distributionDomainName = cdk.Fn.importValue(
      `${props.adminFrontendStackName}:ExportsOutputFnGetAttAdminDistribution4E89F8C0DomainName8692121E`,
    )
    const distribution = cloudfront.Distribution.fromDistributionAttributes(
      this,
      'AdminDistributionRef',
      {
        distributionId: cdk.Fn.importValue(
          `${props.adminFrontendStackName}:ExportsOutputRefAdminDistribution4E89F8C01FE8A95D`,
        ),
        domainName: distributionDomainName,
      },
    )

    const cognitoAdminClientId = cdk.Fn.importValue(
      `${props.cognitoStackName}:ExportsOutputRefUserPoolAdminAppClientCD59D22143082BED`,
    )

    const distPath = path.join(__dirname, '../../../../apps/admin-web/dist')
    if (fs.existsSync(distPath)) {
      new s3deploy.BucketDeployment(this, 'DeployAdmin', {
        sources: [
          s3deploy.Source.asset(distPath),
          s3deploy.Source.jsonData('config.json', {
            apiUrl: props.apiUrl,
            cognito: {
              domain: props.cognitoDomain,
              clientId: cognitoAdminClientId,
              redirectUri: `https://${distributionDomainName}/auth/callback`,
            },
          }),
        ],
        destinationBucket: adminBucket,
        distribution,
        distributionPaths: ['/*'],
      })
    }
  }
}
