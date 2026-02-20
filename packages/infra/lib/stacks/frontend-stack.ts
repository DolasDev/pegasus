import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import { type Construct } from 'constructs'

/**
 * FrontendStack provisions the static hosting infrastructure for the Pegasus React SPA.
 *
 * Resources:
 *   - S3 bucket (private, no public access) — stores compiled frontend assets
 *   - CloudFront distribution — HTTPS delivery, SPA routing fallback, Origin Access Control
 */
export class FrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        // S3BucketOrigin.withOriginAccessControl creates an OAC (not the legacy OAI)
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
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
