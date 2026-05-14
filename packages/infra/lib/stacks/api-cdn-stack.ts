import * as cdk from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { type Construct } from 'constructs'

// SSM parameters published by dolas-infra's PegasusApiDnsBootstrapStack into
// each Pegasus account. Read at deploy time when attachCustomDomain is set.
const CERT_ARN_PARAM = '/dolas/pegasus/api/cert-arn'
const DOMAIN_NAME_PARAM = '/dolas/pegasus/api/domain-name'
// Written back here so dolas-infra's PegasusDnsAliasStack can wire the
// api.pegasus[-qa].dolas.dev alias A/AAAA records.
const DISTRIBUTION_DOMAIN_PARAM = '/dolas/pegasus/api/distribution-domain'

export interface ApiCdnStackProps extends cdk.StackProps {
  /**
   * The HTTP API Gateway v2 API ID from ApiStack. Used to derive the regional
   * origin hostname `{id}.execute-api.{region}.amazonaws.com`. MonitoringStack
   * already consumes apiStack.httpApiId as a construct ref, so passing it
   * here shares the same auto-export rather than creating a new one.
   */
  readonly httpApiId: string

  /**
   * Region the HTTP API lives in. Used to build the origin hostname.
   */
  readonly httpApiRegion: string

  /**
   * When true, attaches the dolas-managed custom domain (cert + domain name)
   * read from SSM, and publishes the resulting CloudFront domain back to SSM
   * so dolas-infra can create the api.* alias records. Set for staging / prod;
   * leave false for dev so the stack stays self-contained.
   */
  readonly attachCustomDomain?: boolean
}

/**
 * ApiCdnStack puts a CloudFront distribution in front of the Pegasus HTTP
 * API (api-stack.ts) and, in staging/prod, attaches the custom domain
 * `api.pegasus[-qa].dolas.dev`.
 *
 * The distribution is intentionally cache-disabled (every API call hits the
 * origin) — CloudFront is here for the custom domain + TLS, WAF/Shield, and
 * edge TLS termination, not response caching.
 *
 * Host header handling: API Gateway routes by URL only, but the regional
 * endpoint expects `Host: {id}.execute-api.{region}.amazonaws.com`. Forwarding
 * the viewer's Host (`api.pegasus.dolas.dev`) makes the regional endpoint
 * 403. We use ALL_VIEWER_EXCEPT_HOST_HEADER so the Host stays as the origin's.
 */
export class ApiCdnStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution

  constructor(scope: Construct, id: string, props: ApiCdnStackProps) {
    super(scope, id, props)

    const { httpApiId, httpApiRegion, attachCustomDomain } = props

    const customDomain = attachCustomDomain
      ? {
          domainName: ssm.StringParameter.valueForStringParameter(this, DOMAIN_NAME_PARAM),
          certificate: acm.Certificate.fromCertificateArn(
            this,
            'CustomDomainCertificate',
            ssm.StringParameter.valueForStringParameter(this, CERT_ARN_PARAM),
          ),
        }
      : undefined

    const originDomain = `${httpApiId}.execute-api.${httpApiRegion}.amazonaws.com`

    const apiOrigin = new origins.HttpOrigin(originDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
    })

    this.distribution = new cloudfront.Distribution(this, 'ApiDistribution', {
      ...(customDomain && {
        domainNames: [customDomain.domainName],
        certificate: customDomain.certificate,
      }),
      defaultBehavior: {
        origin: apiOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        compress: true,
      },
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    })

    new cdk.CfnOutput(this, 'ApiDistributionDomain', {
      value: this.distribution.distributionDomainName,
    })

    new cdk.CfnOutput(this, 'ApiDistributionId', {
      value: this.distribution.distributionId,
    })

    if (customDomain) {
      new ssm.StringParameter(this, 'DistributionDomainParam', {
        parameterName: DISTRIBUTION_DOMAIN_PARAM,
        stringValue: this.distribution.distributionDomainName,
        description:
          'CloudFront distribution domain for the Pegasus API. Read by dolas-infra PegasusDnsAliasStack to create the api.* alias.',
      })
    }
  }
}
