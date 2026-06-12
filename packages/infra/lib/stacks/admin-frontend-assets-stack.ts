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

// SSM parameter published by dolas-infra — the branded admin web domain
// (admin.pegasus[-qa].dolas.dev). Read at deploy time when useWebCustomDomain
// is set so config.json's redirectUri (and the logout_uri derived from it)
// stays on the brand instead of the raw *.cloudfront.net host.
const ADMIN_DOMAIN_NAME_PARAM = '/dolas/pegasus/admin/domain-name'

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
  /**
   * Name of the upstream ApiStack — used to build a stable Fn::ImportValue
   * for the API Gateway endpoint. Same drift-immunity rationale as
   * adminFrontendStackName / cognitoStackName.
   */
  readonly apiStackName: string
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
  /**
   * When true, config.json's cognito.redirectUri points at the branded admin
   * web domain (https://admin.pegasus[-qa].dolas.dev/auth/callback, read from
   * SSM) instead of the raw CloudFront distribution domain. Set for
   * staging/prod; leave false for dev. Keeps a signed-out admin on the brand —
   * signOut() derives its post-logout redirect from this value. The matching
   * URL must also be registered in CognitoStack's admin callback/logout URLs.
   */
  readonly useWebCustomDomain?: boolean
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

    // Reconstruct the Cognito Hosted UI URL on the consumer side from the
    // pinned UserPoolDomain Ref export. See frontend-assets-stack.ts for the
    // rationale — short version: keeps the export contract owned by us
    // instead of derived from a CDK-generated logical-ID hash.
    const cognitoRegion = props.cognitoRegion ?? 'us-east-1'
    const cognitoDomain = cdk.Fn.join('', [
      'https://',
      cdk.Fn.importValue(
        `${props.cognitoStackName}:ExportsOutputRefUserPoolHostedUiDomainE021B0B644BA1D58`,
      ),
      `.auth.${cognitoRegion}.amazoncognito.com`,
    ])

    const apiUrl = props.useApiCustomDomain
      ? cdk.Fn.join('', [
          'https://',
          ssm.StringParameter.valueForStringParameter(this, API_DOMAIN_NAME_PARAM),
        ])
      : cdk.Fn.importValue(
          `${props.apiStackName}:ExportsOutputFnGetAttPegasusHttpApiF652FECBApiEndpointFD99A5D1`,
        )

    // redirectUri host: branded domain when attached (staging/prod), else the
    // raw CloudFront domain (dev). signOut() in the admin app derives the
    // post-logout redirect from this, so the brand stays in the address bar.
    const redirectUri = props.useWebCustomDomain
      ? cdk.Fn.join('', [
          'https://',
          ssm.StringParameter.valueForStringParameter(this, ADMIN_DOMAIN_NAME_PARAM),
          '/auth/callback',
        ])
      : `https://${distributionDomainName}/auth/callback`

    const distPath = path.join(__dirname, '../../../../apps/admin-web/dist')
    if (fs.existsSync(distPath)) {
      new s3deploy.BucketDeployment(this, 'DeployAdmin', {
        sources: [
          s3deploy.Source.asset(distPath),
          s3deploy.Source.jsonData('config.json', {
            apiUrl,
            cognito: {
              domain: cognitoDomain,
              clientId: cognitoAdminClientId,
              redirectUri,
            },
          }),
        ],
        destinationBucket: adminBucket,
        distribution,
        distributionPaths: ['/*'],
        // prune:false — keep prior hashed chunks so open admin tabs don't 404
        // on dynamic imports mid-deploy and rollbacks need no bucket
        // archaeology. See the tenant FrontendAssetsStack for the full
        // rationale and docs/runbooks/rollback.md for the quarterly prune.
        prune: false,
      })
    }
  }
}
