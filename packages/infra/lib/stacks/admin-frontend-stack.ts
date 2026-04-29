import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { type Construct } from 'constructs'

// SSM parameters published by dolas-infra's PegasusAdminDnsBootstrapStack into
// each Pegasus account. Read at deploy time when attachCustomDomain is set.
const CERT_ARN_PARAM = '/dolas/pegasus/admin/cert-arn'
const DOMAIN_NAME_PARAM = '/dolas/pegasus/admin/domain-name'
// Written back here so dolas-infra's PegasusAdminDnsAlias stack can wire the
// admin.* alias records inside the existing pegasus[-qa].dolas.dev subzone.
const DISTRIBUTION_DOMAIN_PARAM = '/dolas/pegasus/admin/distribution-domain'

export interface AdminFrontendStackProps extends cdk.StackProps {
  /**
   * When true, attaches the dolas-managed admin custom domain (cert + domain
   * name) read from SSM, and publishes the resulting CloudFront domain back to
   * SSM so dolas-infra can create the admin.* alias records. Set for
   * staging / prod; leave false for dev so the stack stays self-contained.
   */
  readonly attachCustomDomain?: boolean
}

/**
 * AdminFrontendStack provisions the static hosting infrastructure for the
 * Pegasus Admin Portal React SPA (apps/admin-web).
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

  constructor(scope: Construct, id: string, props: AdminFrontendStackProps = {}) {
    super(scope, id, props)

    const customDomain = props.attachCustomDomain
      ? {
          domainName: ssm.StringParameter.valueForStringParameter(this, DOMAIN_NAME_PARAM),
          certificate: acm.Certificate.fromCertificateArn(
            this,
            'CustomDomainCertificate',
            ssm.StringParameter.valueForStringParameter(this, CERT_ARN_PARAM),
          ),
        }
      : undefined

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
      ...(customDomain && {
        domainNames: [customDomain.domainName],
        certificate: customDomain.certificate,
      }),
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

    // ---------------------------------------------------------------------------
    // Cross-stack exports for AdminFrontendAssetsStack — see frontend-stack.ts
    // for the rationale. Same pinning approach: explicit logical IDs + names so
    // we own the export contract instead of CDK's auto-export mechanism.
    //
    // Note: distributionDomainName is intentionally NOT pinned here because
    // CognitoStack still consumes it as a construct-level cross-stack ref.
    // CDK auto-generates that export with the same logical ID.
    // ---------------------------------------------------------------------------
    const bucketArnExport = new cdk.CfnOutput(this, 'AssetsAdminBucketArnExport', {
      value: this.adminBucket.bucketArn,
      exportName: `${this.stackName}:ExportsOutputFnGetAttAdminBucketB0A70AB7ArnB4CAD264`,
    })
    bucketArnExport.overrideLogicalId('ExportsOutputFnGetAttAdminBucketB0A70AB7ArnB4CAD264')

    const bucketRefExport = new cdk.CfnOutput(this, 'AssetsAdminBucketRefExport', {
      value: this.adminBucket.bucketName,
      exportName: `${this.stackName}:ExportsOutputRefAdminBucketB0A70AB74CDEAEE9`,
    })
    bucketRefExport.overrideLogicalId('ExportsOutputRefAdminBucketB0A70AB74CDEAEE9')

    const distributionRefExport = new cdk.CfnOutput(this, 'AssetsAdminDistRefExport', {
      value: this.distribution.distributionId,
      exportName: `${this.stackName}:ExportsOutputRefAdminDistribution4E89F8C01FE8A95D`,
    })
    distributionRefExport.overrideLogicalId('ExportsOutputRefAdminDistribution4E89F8C01FE8A95D')

    if (customDomain) {
      new ssm.StringParameter(this, 'DistributionDomainParam', {
        parameterName: DISTRIBUTION_DOMAIN_PARAM,
        stringValue: this.distribution.distributionDomainName,
        description:
          'CloudFront distribution domain for the admin portal. Read by dolas-infra PegasusAdminDnsAlias stack to create the admin.* alias inside the existing pegasus[-qa].dolas.dev subzone.',
      })
    }
  }
}
