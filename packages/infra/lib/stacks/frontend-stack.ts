import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { type Construct } from 'constructs'

// SSM parameters published by dolas-infra's PegasusDnsBootstrapStack into
// each Pegasus account. Read at deploy time when attachCustomDomain is set.
const CERT_ARN_PARAM = '/dolas/pegasus/web/cert-arn'
const DOMAIN_NAME_PARAM = '/dolas/pegasus/web/domain-name'
// Written back here so dolas-infra's PegasusDnsAliasStack can wire the
// apex A/AAAA records.
const DISTRIBUTION_DOMAIN_PARAM = '/dolas/pegasus/web/distribution-domain'

export interface FrontendStackProps extends cdk.StackProps {
  /**
   * When true, attaches the dolas-managed custom domain (cert + domain name)
   * read from SSM, and publishes the resulting CloudFront domain back to SSM
   * so dolas-infra can create the apex alias records. Set for staging / prod;
   * leave false for dev so the stack stays self-contained.
   */
  readonly attachCustomDomain?: boolean
}

/**
 * FrontendStack provisions the static hosting infrastructure for the Pegasus React SPA.
 *
 * Resources:
 *   - S3 bucket (private, no public access) — stores compiled frontend assets
 *   - CloudFront distribution — HTTPS delivery, SPA routing fallback, Origin Access Control
 *
 * Asset deployment (config.json) is handled by FrontendAssetsStack, which depends on
 * this stack for the bucket and distribution references plus CognitoStack / ApiStack
 * for runtime configuration values.
 */
export class FrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution
  public readonly siteBucket: s3.Bucket

  constructor(scope: Construct, id: string, props: FrontendStackProps = {}) {
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
    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
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
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket)

    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      ...(customDomain && {
        domainNames: [customDomain.domainName],
        certificate: customDomain.certificate,
      }),
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
      value: this.siteBucket.bucketName,
      exportName: 'PegasusSiteBucketName',
    })

    // ---------------------------------------------------------------------------
    // Cross-stack exports for FrontendAssetsStack
    //
    // Pinned to the logical IDs and export names that CDK's auto-export
    // mechanism generated when FrontendAssetsStack passed siteBucket as a
    // construct ref. Now that the assets stack imports them by name via
    // Fn::ImportValue (see frontend-assets-stack.ts), CDK no longer auto-emits
    // these — they're declared explicitly so the export contract stays stable
    // across CDK versions and consumer-side refactors. Renaming or removing
    // these breaks the assets stack at deploy time, so leave them alone.
    //
    // Note: distributionDomainName is intentionally NOT pinned here because
    // CognitoStack still consumes it as a construct-level cross-stack ref
    // (for OAuth callback URLs). CDK auto-generates that export with the same
    // logical ID; declaring it manually causes a synth-time duplicate.
    // ---------------------------------------------------------------------------
    const bucketArnExport = new cdk.CfnOutput(this, 'AssetsSiteBucketArnExport', {
      value: this.siteBucket.bucketArn,
      exportName: `${this.stackName}:ExportsOutputFnGetAttSiteBucket397A1860ArnB404F589`,
    })
    bucketArnExport.overrideLogicalId('ExportsOutputFnGetAttSiteBucket397A1860ArnB404F589')

    const bucketRefExport = new cdk.CfnOutput(this, 'AssetsSiteBucketRefExport', {
      value: this.siteBucket.bucketName,
      exportName: `${this.stackName}:ExportsOutputRefSiteBucket397A1860ADBF1315`,
    })
    bucketRefExport.overrideLogicalId('ExportsOutputRefSiteBucket397A1860ADBF1315')

    const distributionRefExport = new cdk.CfnOutput(this, 'AssetsSiteDistRefExport', {
      value: this.distribution.distributionId,
      exportName: `${this.stackName}:ExportsOutputRefSiteDistribution3FF9535D7CFA9D06`,
    })
    distributionRefExport.overrideLogicalId('ExportsOutputRefSiteDistribution3FF9535D7CFA9D06')

    if (customDomain) {
      new ssm.StringParameter(this, 'DistributionDomainParam', {
        parameterName: DISTRIBUTION_DOMAIN_PARAM,
        stringValue: this.distribution.distributionDomainName,
        description:
          'CloudFront distribution domain for the tenant frontend. Read by dolas-infra PegasusDnsAliasStack to create the apex alias.',
      })
    }
  }
}
