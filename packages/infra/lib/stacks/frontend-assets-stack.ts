import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { type Construct } from 'constructs'

// SSM parameter published by dolas-infra's PegasusApiDnsBootstrapStack —
// the branded API domain (api.pegasus[-qa].dolas.dev). Read at deploy time
// when useApiCustomDomain is set.
const API_DOMAIN_NAME_PARAM = '/dolas/pegasus/api/domain-name'

export interface FrontendAssetsStackProps extends cdk.StackProps {
  /**
   * Name of the upstream FrontendStack — used to build Fn::ImportValue strings
   * for the bucket and distribution. Imported by name (not construct ref) so
   * that CDK's auto-export mechanism doesn't generate logical-ID-derived
   * exports that drift between CDK versions. The stable exports themselves
   * live in FrontendStack and are pinned via overrideLogicalId there.
   */
  readonly frontendStackName: string
  /**
   * Name of the upstream ApiStack — used to build a stable Fn::ImportValue
   * for the API Gateway endpoint. Same drift-immunity rationale as
   * frontendStackName: passing the construct ref directly lets CDK
   * auto-generate the export logical ID, and that ID has empirically drifted
   * across CDK minor versions, blocking api-stack updates with
   * "Cannot delete export … as it is in use by …-frontend-assets …".
   */
  readonly apiStackName: string
  /**
   * Name of the upstream CognitoStack — used to build stable Fn::ImportValue
   * strings for the user pool ID, tenant client ID, and Hosted UI domain.
   * Same drift-immunity rationale as frontendStackName / apiStackName: passing
   * the construct refs directly lets CDK auto-generate the export logical IDs,
   * and those IDs have empirically drifted across CDK minor versions, blocking
   * cognito-stack updates with "Cannot delete export … as it is in use by …".
   */
  readonly cognitoStackName: string
  /** AWS region of the Cognito User Pool. Defaults to us-east-1. */
  readonly cognitoRegion?: string
  /**
   * When true, config.json's apiUrl points at the branded API domain
   * (https://api.pegasus[-qa].dolas.dev, read from SSM) instead of the raw
   * API Gateway execute-api URL. Set for staging/prod; leave false for dev,
   * which has no custom API domain and keeps the execute-api URL.
   *
   * The branded URL is stable across API Gateway replacements and routes
   * through CloudFront (WAF/Shield); the execute-api URL has neither property.
   */
  readonly useApiCustomDomain?: boolean
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

    const apiUrl = props.useApiCustomDomain
      ? cdk.Fn.join('', [
          'https://',
          ssm.StringParameter.valueForStringParameter(this, API_DOMAIN_NAME_PARAM),
        ])
      : cdk.Fn.importValue(
          `${props.apiStackName}:ExportsOutputFnGetAttPegasusHttpApiF652FECBApiEndpointFD99A5D1`,
        )

    // Cognito values via stable named imports — see CognitoStack for the
    // pinned CfnOutput declarations and the rationale.
    const cognitoRegion = props.cognitoRegion ?? 'us-east-1'
    const cognitoUserPoolId = cdk.Fn.importValue(
      `${props.cognitoStackName}:ExportsOutputRefUserPool6BA7E5F296FD7236`,
    )
    const cognitoTenantClientId = cdk.Fn.importValue(
      `${props.cognitoStackName}:ExportsOutputRefUserPoolTenantAppClientA86A3129C4F3A42A`,
    )
    // The pinned export holds the UserPoolDomain Ref (the prefix). Reconstruct
    // the full https://…amazoncognito.com URL on the consumer side so the
    // rendered config.json is byte-identical to what the construct-token path
    // produced via UserPoolDomain.baseUrl().
    const cognitoDomain = cdk.Fn.join('', [
      'https://',
      cdk.Fn.importValue(
        `${props.cognitoStackName}:ExportsOutputRefUserPoolHostedUiDomainE021B0B644BA1D58`,
      ),
      `.auth.${cognitoRegion}.amazoncognito.com`,
    ])

    const distPath = path.join(__dirname, '../../../../apps/tenant-web/dist')
    if (fs.existsSync(distPath)) {
      new s3deploy.BucketDeployment(this, 'DeployWebsite', {
        sources: [
          s3deploy.Source.asset(distPath),
          s3deploy.Source.jsonData('config.json', {
            apiUrl,
            cognito: {
              region: cognitoRegion,
              userPoolId: cognitoUserPoolId,
              clientId: cognitoTenantClientId,
              domain: cognitoDomain,
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
