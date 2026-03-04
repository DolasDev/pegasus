import * as fs from 'fs'
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as path from 'path'
import { type Construct } from 'constructs'

export interface FrontendStackProps extends cdk.StackProps {
  /**
   * API Gateway URL — injected into /config.json at deploy time.
   * Optional: when omitted the config.json source is not included (infra-only pass).
   */
  readonly apiUrl?: string
  /** AWS region of the Cognito User Pool (e.g. us-east-1). Defaults to us-east-1. */
  readonly cognitoRegion?: string
  /** Cognito User Pool ID. Required together with other Cognito props to generate config.json. */
  readonly cognitoUserPoolId?: string
  /** Tenant app client ID (PKCE, no secret). Required together with other Cognito props. */
  readonly cognitoTenantClientId?: string
  /** Cognito Hosted UI base URL (e.g. https://pegasus-123.auth.us-east-1.amazoncognito.com). */
  readonly cognitoDomain?: string
}

/**
 * FrontendStack provisions the static hosting infrastructure for the Pegasus React SPA.
 *
 * Resources:
 *   - S3 bucket (private, no public access) — stores compiled frontend assets
 *   - CloudFront distribution — HTTPS delivery, SPA routing fallback, Origin Access Control
 *   - /config.json — generated at deploy time via s3deploy.Source.jsonData with resolved
 *     CloudFormation tokens (API URL, Cognito settings, redirect URI)
 */
export class FrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution

  constructor(scope: Construct, id: string, props: FrontendStackProps = {}) {
    super(scope, id, props)

    // ---------------------------------------------------------------------------
    // S3 bucket — private, no direct public access
    // ---------------------------------------------------------------------------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      // Retain on stack deletion to avoid accidental data loss
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // ---------------------------------------------------------------------------
    // CloudFront distribution — HTTPS only, OAC, SPA routing fallback
    // ---------------------------------------------------------------------------
    // Shared origin — S3BucketOrigin.withOriginAccessControl creates one OAC per
    // call so we create it once and reuse it across all cache behaviours.
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(siteBucket)

    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        // S3BucketOrigin.withOriginAccessControl creates an OAC (not the legacy OAI)
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
      // Serve index.html for the root path
      defaultRootObject: 'index.html',
      // SPA routing — map 403/404 from S3 to index.html so the React Router
      // handles the route on the client side
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
    //
    // Only added when the built dist directory exists so synth succeeds without
    // a prior build (important for CDK unit tests and pull-request synthesis).
    //
    // When all Cognito/API props are provided, a config.json source is appended
    // so the tenant app boots with the correct runtime configuration. On the
    // first (infra-only) deploy pass, props are omitted and no config.json is
    // generated — the CloudFront URL is captured so CognitoStack can register
    // it as a callback URL before the second (asset) pass runs.
    // ---------------------------------------------------------------------------
    const distPath = path.join(__dirname, '../../../../packages/web/dist')
    if (fs.existsSync(distPath)) {
      const sources: s3deploy.ISource[] = [s3deploy.Source.asset(distPath)]

      if (
        props.apiUrl &&
        props.cognitoUserPoolId &&
        props.cognitoTenantClientId &&
        props.cognitoDomain
      ) {
        sources.push(
          s3deploy.Source.jsonData('config.json', {
            apiUrl: props.apiUrl,
            cognito: {
              region: props.cognitoRegion ?? 'us-east-1',
              userPoolId: props.cognitoUserPoolId,
              clientId: props.cognitoTenantClientId,
              domain: props.cognitoDomain,
              redirectUri: `https://${this.distribution.distributionDomainName}/login/callback`,
            },
          }),
        )
      }

      new s3deploy.BucketDeployment(this, 'DeployWebsite', {
        sources,
        destinationBucket: siteBucket,
        distribution: this.distribution,
        distributionPaths: ['/*'],
      })
    }

    // ---------------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      exportName: 'PegasusDistributionUrl',
    })

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      exportName: 'PegasusDistributionId',
    })

    new cdk.CfnOutput(this, 'SiteBucketName', {
      value: siteBucket.bucketName,
      exportName: 'PegasusSiteBucketName',
    })
  }
}
