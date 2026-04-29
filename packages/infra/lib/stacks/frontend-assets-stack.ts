import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { type Construct } from 'constructs'

export interface FrontendAssetsStackProps extends cdk.StackProps {
  /**
   * Name of the upstream FrontendStack — used to build Fn::ImportValue strings
   * for the bucket and distribution. Imported by name (not construct ref) so
   * that CDK's auto-export mechanism doesn't generate logical-ID-derived
   * exports that drift between CDK versions. The stable exports themselves
   * live in FrontendStack and are pinned via overrideLogicalId there.
   */
  readonly frontendStackName: string
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

    // Reconstruct the upstream bucket and distribution from stable named
    // imports rather than construct refs, so CDK doesn't synthesise auto
    // cross-stack exports whose logical IDs can drift across releases.
    const siteBucket = s3.Bucket.fromBucketAttributes(this, 'SiteBucketRef', {
      bucketArn: cdk.Fn.importValue(
        `${props.frontendStackName}:ExportsOutputFnGetAttSiteBucket397A1860ArnB404F589`,
      ),
      bucketName: cdk.Fn.importValue(
        `${props.frontendStackName}:ExportsOutputRefSiteBucket397A1860ADBF1315`,
      ),
    })

    const distributionDomainName = cdk.Fn.importValue(
      `${props.frontendStackName}:ExportsOutputFnGetAttSiteDistribution3FF9535DDomainNameE0908095`,
    )
    const distribution = cloudfront.Distribution.fromDistributionAttributes(
      this,
      'SiteDistributionRef',
      {
        distributionId: cdk.Fn.importValue(
          `${props.frontendStackName}:ExportsOutputRefSiteDistribution3FF9535D7CFA9D06`,
        ),
        domainName: distributionDomainName,
      },
    )

    const distPath = path.join(__dirname, '../../../../apps/tenant-web/dist')
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
              redirectUri: `https://${distributionDomainName}/login/callback`,
            },
          }),
        ],
        destinationBucket: siteBucket,
        distribution,
        distributionPaths: ['/*'],
      })
    }
  }
}
