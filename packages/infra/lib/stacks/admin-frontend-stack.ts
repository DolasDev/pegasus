import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import { type Construct } from 'constructs'

/**
 * AdminFrontendStack provisions the static hosting infrastructure for the
 * Pegasus Admin Portal React SPA (apps/admin).
 *
 * Resources:
 *   - S3 bucket (private, no public access) — stores compiled admin assets
 *   - CloudFront distribution — HTTPS delivery, SPA routing fallback, OAC
 *
 * Asset deployment (config.json) is handled by AdminFrontendAssetsStack, which
 * depends on this stack for the bucket and distribution references.
 */
export class AdminFrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution
  public readonly adminBucket: s3.Bucket

  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props)

    // ---------------------------------------------------------------------------
    // S3 bucket — private, no direct public access
    // ---------------------------------------------------------------------------
    this.adminBucket = new s3.Bucket(this, 'AdminBucket', {
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
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.adminBucket)

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
      value: this.adminBucket.bucketName,
      exportName: 'PegasusAdminBucketName',
    })
  }
}
