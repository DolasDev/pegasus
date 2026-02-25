import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { type Construct } from 'constructs'

export interface AdminFrontendStackProps extends cdk.StackProps {
  /**
   * API Gateway URL injected into /config.json. Optional — when omitted the
   * config.json source is not included (first-pass / infra-only deploy).
   */
  readonly apiUrl?: string
  /**
   * Cognito Hosted UI base URL (e.g. https://pegasus-123.auth.us-east-1.amazoncognito.com).
   * Required together with apiUrl and cognitoAdminClientId to generate config.json.
   */
  readonly cognitoDomain?: string
  /** Admin app client ID. Required together with apiUrl and cognitoDomain. */
  readonly cognitoAdminClientId?: string
}

/**
 * AdminFrontendStack provisions the static hosting infrastructure for the
 * Pegasus Admin Portal React SPA (apps/admin).
 *
 * Resources:
 *   - S3 bucket (private, no public access) — stores compiled admin assets
 *   - CloudFront distribution — HTTPS delivery, SPA routing fallback, OAC
 *
 * The BucketDeployment is added only when the built dist directory exists
 * (`apps/admin/dist`). This allows CDK synth (including test synthesis) to
 * succeed without requiring a prior Vite build. CI/CD pipelines should run
 * `npm run build` in apps/admin before `cdk deploy`.
 *
 * When all three optional props (apiUrl, cognitoDomain, cognitoAdminClientId)
 * are provided, a /config.json file is generated at deploy time and uploaded
 * alongside the SPA assets.
 */
export class AdminFrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution

  constructor(scope: Construct, id: string, props: AdminFrontendStackProps = {}) {
    super(scope, id, props)

    // ---------------------------------------------------------------------------
    // S3 bucket — private, no direct public access
    // ---------------------------------------------------------------------------
    const adminBucket = new s3.Bucket(this, 'AdminBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // ---------------------------------------------------------------------------
    // CloudFront distribution — HTTPS only, OAC, SPA routing fallback
    // ---------------------------------------------------------------------------
    // Shared origin — S3BucketOrigin.withOriginAccessControl creates one OAC per
    // call so we create it once and reuse it across all cache behaviours.
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(adminBucket)

    this.distribution = new cloudfront.Distribution(this, 'AdminDistribution', {
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
      },
      // /config.json is served without caching so updates take effect immediately.
      additionalBehaviors: {
        '/config.json': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },
      },
      defaultRootObject: 'index.html',
      // SPA routing — serve index.html for any path so TanStack Router handles
      // client-side navigation even on hard refresh / deep link.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      httpVersion: cloudfront.HttpVersion.HTTP2,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    })

    // ---------------------------------------------------------------------------
    // Deploy assets to S3 and invalidate CloudFront
    // Only added when the built dist directory exists so synth succeeds without
    // a prior build (important for CDK unit tests and pull-request synthesis).
    //
    // When all three Cognito/API props are provided, a config.json source is
    // appended so the admin app boots with the correct runtime configuration.
    // ---------------------------------------------------------------------------
    const distPath = path.join(__dirname, '../../../../apps/admin/dist')
    if (fs.existsSync(distPath)) {
      const sources: s3deploy.ISource[] = [s3deploy.Source.asset(distPath)]

      if (props.apiUrl && props.cognitoDomain && props.cognitoAdminClientId) {
        sources.push(
          s3deploy.Source.jsonData('config.json', {
            apiUrl: props.apiUrl,
            cognito: {
              domain: props.cognitoDomain,
              clientId: props.cognitoAdminClientId,
              redirectUri: `https://${this.distribution.distributionDomainName}/auth/callback`,
            },
          }),
        )
      }

      new s3deploy.BucketDeployment(this, 'DeployAdmin', {
        sources,
        destinationBucket: adminBucket,
        distribution: this.distribution,
        distributionPaths: ['/*'],
      })
    }

    // ---------------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'AdminDistributionUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      exportName: 'PegasusAdminDistributionUrl',
    })

    new cdk.CfnOutput(this, 'AdminDistributionId', {
      value: this.distribution.distributionId,
      exportName: 'PegasusAdminDistributionId',
    })

    new cdk.CfnOutput(this, 'AdminBucketName', {
      value: adminBucket.bucketName,
      exportName: 'PegasusAdminBucketName',
    })
  }
}
