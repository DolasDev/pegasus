import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigwv2i from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { type Construct } from 'constructs'
import type { DatabaseStack } from './database-stack'

interface ApiStackProps extends cdk.StackProps {
  readonly databaseStack: DatabaseStack
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props)

    const { databaseStack } = props

    const apiFunction = new nodejs.NodejsFunction(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      // Entry resolved relative to this file at deploy time by esbuild
      entry: path.join(__dirname, '../../../api/src/lambda.ts'),
      handler: 'handler',
      vpc: databaseStack.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      // Use the pre-created SG from DatabaseStack to avoid cross-stack SG cycles
      securityGroups: [databaseStack.lambdaSecurityGroup],
      environment: {
        NODE_ENV: 'production',
        // RDS Proxy endpoint (CloudFormation GetAtt — resolved at deploy time)
        DB_PROXY_ENDPOINT: databaseStack.proxy.endpoint,
        // Secrets Manager secret ARN — Lambda fetches credentials at startup
        DB_SECRET_ARN: databaseStack.secret.secretArn,
        DB_PORT: '5432',
        DB_NAME: 'pegasus',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),
    })

    // ---------------------------------------------------------------------------
    // IAM: sm:GetSecretValue to read DB credentials
    // ---------------------------------------------------------------------------
    databaseStack.secret.grantRead(apiFunction)

    // ---------------------------------------------------------------------------
    // IAM: rds-db:connect to authenticate via RDS Proxy IAM auth
    // ---------------------------------------------------------------------------
    databaseStack.proxy.grantConnect(apiFunction, 'postgres')

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
