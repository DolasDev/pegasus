import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
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
      // Entry is resolved at deploy time by esbuild — path is relative to this file
      entry: path.join(__dirname, '../../../../api/src/index.ts'),
      handler: 'handler',
      vpc: databaseStack.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        NODE_ENV: 'production',
        DB_HOST: databaseStack.cluster.clusterEndpoint.hostname,
        DB_PORT: databaseStack.cluster.clusterEndpoint.port.toString(),
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),
    })

    // Allow the Lambda function to connect to the Aurora cluster
    databaseStack.cluster.connections.allowDefaultPortFrom(apiFunction)

    const api = new apigateway.RestApi(this, 'PegasusRestApi', {
      restApiName: 'Pegasus Move Management API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: 'v1',
        tracingEnabled: true,
      },
    })

    const integration = new apigateway.LambdaIntegration(apiFunction, {
      proxy: true,
    })

    api.root.addProxy({
      defaultIntegration: integration,
      anyMethod: true,
    })

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      exportName: 'PegasusApiUrl',
    })
  }
}
