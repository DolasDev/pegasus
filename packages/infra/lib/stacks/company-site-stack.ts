import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { type Construct } from 'constructs'

// SSM parameters published by dolas-infra's PegasusCompanyDnsStack into the
// Pegasus prod account. Read at deploy time when attachCustomDomain is set.
const COMPANY_CERT_ARN_PARAM = '/dolas/pegasus/company/cert-arn'
const COMPANY_DOMAIN_NAME_PARAM = '/dolas/pegasus/company/domain-name'

// Written back here so dolas-infra's company DNS stack can point the apex +
// www alias records at this distribution. Published unconditionally (not only
// when the custom domain is attached): a distribution's *.cloudfront.net
// domain does not change when aliases are added later, so publishing it early
// lets the alias records and the ACM certificate be created in the same
// dolas-infra pass — before this stack ever claims the domain.
const COMPANY_DISTRIBUTION_DOMAIN_PARAM = '/dolas/pegasus/company/distribution-domain'

export interface CompanySiteStackProps extends cdk.StackProps {
  /**
   * When true, attaches the company domain (apex + www) read from SSM and
   * installs the www → apex redirect function. Requires dolas-infra to have
   * issued the certificate first (see the rollout order in
   * plans/completed/*-company-website.md). Left false until the registrar's
   * nameservers point at Route 53 and the cert has validated — CloudFront
   * rejects an alias whose certificate does not cover it, and a missing SSM
   * parameter fails the deploy outright.
   */
  readonly attachCustomDomain?: boolean
}

/**
 * CompanySiteStack hosts the public company/marketing site
 * (pegasusmovemanager.com) — a hand-written static site in apps/company-web.
 *
 * Resources:
 *   - S3 bucket (private, no public access) — the site's flat files
 *   - CloudFront distribution — HTTPS delivery via Origin Access Control
 *   - BucketDeployment — uploads apps/company-web and invalidates the CDN
 *
 * Deliberately NOT modelled on FrontendStack's SPA behaviour: that stack maps
 * 403/404 to `/index.html` with a 200 so a client-side router can take over.
 * This is a plain static site, so a missing key must stay a 404 — mapping it
 * to a 200 would make every typo look like a working page (and has previously
 * made a deployed page's absence invisible to status-code checks).
 */
export class CompanySiteStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution
  public readonly siteBucket: s3.Bucket

  constructor(scope: Construct, id: string, props: CompanySiteStackProps = {}) {
    super(scope, id, props)

    const customDomain = props.attachCustomDomain
      ? {
          domainName: ssm.StringParameter.valueForStringParameter(this, COMPANY_DOMAIN_NAME_PARAM),
          certificate: acm.Certificate.fromCertificateArn(
            this,
            'CompanySiteCertificate',
            ssm.StringParameter.valueForStringParameter(this, COMPANY_CERT_ARN_PARAM),
          ),
        }
      : undefined

    // -------------------------------------------------------------------------
    // S3 bucket — private, reached only through the distribution's OAC
    // -------------------------------------------------------------------------
    this.siteBucket = new s3.Bucket(this, 'CompanySiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      // Retain on stack deletion — same rationale as the other site buckets.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // -------------------------------------------------------------------------
    // Security headers — the CSP is ENFORCED, not report-only.
    //
    // The site is hand-written HTML/CSS with no JavaScript, no external fonts
    // and no CDN assets, so `default-src 'self'` costs nothing and holds the
    // line: anything added later that reaches off-origin breaks loudly in
    // review rather than silently widening the policy. (FrontendStack's
    // report-only policy exists because the SPA talks to Cognito and the API;
    // none of that applies here, so its policy is not reused.)
    // -------------------------------------------------------------------------
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'CompanySiteHeaders', {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true }, // X-Content-Type-Options: nosniff
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            "img-src 'self' data:",
            "style-src 'self'",
            "script-src 'none'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'none'",
            "form-action 'none'",
          ].join('; '),
          override: true,
        },
      },
    })

    // -------------------------------------------------------------------------
    // www → apex redirect (only meaningful once the domain is attached)
    //
    // Both hostnames are aliases on one distribution, so without this the site
    // would serve identical content on two URLs. A viewer-request function is
    // the cheapest fix — no second distribution, no S3 redirect bucket.
    // -------------------------------------------------------------------------
    const redirectFunction = customDomain
      ? new cloudfront.Function(this, 'WwwToApexRedirect', {
          runtime: cloudfront.FunctionRuntime.JS_2_0,
          comment: 'Permanent redirect from www.<domain> to the apex domain',
          code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host && request.headers.host.value;
  if (!host || host.indexOf('www.') !== 0) {
    return request;
  }
  var query = '';
  for (var key in request.querystring) {
    query += (query ? '&' : '?') + key + '=' + request.querystring[key].value;
  }
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: { location: { value: 'https://' + host.substring(4) + request.uri + query } },
  };
}
`),
        })
      : undefined

    // -------------------------------------------------------------------------
    // CloudFront distribution
    // -------------------------------------------------------------------------
    this.distribution = new cloudfront.Distribution(this, 'CompanySiteDistribution', {
      ...(customDomain && {
        domainNames: [customDomain.domainName, `www.${customDomain.domainName}`],
        certificate: customDomain.certificate,
      }),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
        responseHeadersPolicy: securityHeaders,
        ...(redirectFunction && {
          functionAssociations: [
            {
              function: redirectFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        }),
      },
      defaultRootObject: 'index.html',
      // A missing object stays an error. S3 with OAC returns 403 (not 404) for
      // a key that isn't there because the bucket policy grants no
      // s3:ListBucket, so both map to the branded 404 page — and both keep a
      // 404 status so crawlers, link checkers and humans all see the truth.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // Marketing traffic from a US-based customer base — the cheapest price
      // class is plenty, and matches dolas-infra's WebsiteCdnStack.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: 'Pegasus company site',
    })

    // -------------------------------------------------------------------------
    // Content — uploaded straight from the repo. There is no build step: the
    // site is hand-written HTML/CSS on purpose, so the source directory IS the
    // artifact.
    // -------------------------------------------------------------------------
    new s3deploy.BucketDeployment(this, 'DeployCompanySite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../../../apps/company-web'))],
      destinationBucket: this.siteBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      // prune: true (the default) — unlike the SPA, these filenames are not
      // content-hashed, so a removed page must actually disappear from the
      // bucket rather than linger at its old URL.
    })

    // -------------------------------------------------------------------------
    // Outputs + cross-repo SSM contract
    // -------------------------------------------------------------------------
    new ssm.StringParameter(this, 'CompanySiteDistributionDomainParam', {
      parameterName: COMPANY_DISTRIBUTION_DOMAIN_PARAM,
      stringValue: this.distribution.distributionDomainName,
      description:
        'CloudFront distribution domain for the Pegasus company site. Read by dolas-infra PegasusCompanyDnsStack to create the apex + www alias records.',
    })

    new cdk.CfnOutput(this, 'CompanySiteUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'CloudFront URL of the company site.',
    })

    new cdk.CfnOutput(this, 'CompanySiteBucketName', {
      value: this.siteBucket.bucketName,
      description: 'S3 origin bucket for the company site.',
    })

    new cdk.CfnOutput(this, 'CompanySiteDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID for the company site.',
    })
  }
}
