import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigwv2i from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { type Construct } from 'constructs'

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ---------------------------------------------------------------------------
    // Secrets Manager: externally-managed Neon connection string
    // ---------------------------------------------------------------------------
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'NeonDatabaseUrl',
      'pegasus/dev/database-url',
    )

    const apiFunction = new nodejs.NodejsFunction(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      // Entry resolved relative to this file at deploy time by esbuild
      entry: path.join(__dirname, '../../../api/src/lambda.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        // CloudFormation dynamic reference — resolved to plaintext at deploy time
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
        // Prisma schema requires DIRECT_URL when directUrl is set. Lambda only runs
        // queries (not migrations), so the pooled URL works for both.
        DIRECT_URL: dbSecret.secretValue.unsafeUnwrap(),
        // Tell Prisma exactly where the native query engine lives so it skips
        // its path-search heuristics (which bake in local build-machine paths).
        PRISMA_QUERY_ENGINE_LIBRARY: '/var/task/libquery_engine-rhel-openssl-3.0.x.so.node',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling(_inputDir: string, outputDir: string): string[] {
            // Copy the Lambda-compatible Prisma query engine binary alongside the
            // bundle. esbuild inlines @prisma/client JS but cannot include native
            // .so.node files, so we copy it explicitly.
            const repoRoot = path.join(__dirname, '../../../..')
            const engine = 'libquery_engine-rhel-openssl-3.0.x.so.node'
            return [
              `cp ${repoRoot}/node_modules/.prisma/client/${engine} ${outputDir}/${engine}`,
            ]
          },
        },
      },
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),
    })

    // ---------------------------------------------------------------------------
    // IAM: sm:GetSecretValue to read the Neon connection string
    // ---------------------------------------------------------------------------
    dbSecret.grantRead(apiFunction)

    // ---------------------------------------------------------------------------
    // API Gateway v2 HTTP API
    // ---------------------------------------------------------------------------
    const httpApi = new apigwv2.HttpApi(this, 'PegasusHttpApi', {
      apiName: 'Pegasus Move Management API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    })

    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new apigwv2i.HttpLambdaIntegration('LambdaIntegration', apiFunction),
    })

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      exportName: 'PegasusApiUrl',
    })
  }
}
