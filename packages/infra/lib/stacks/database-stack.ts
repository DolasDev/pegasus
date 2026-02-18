import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import { type Construct } from 'constructs'

export class DatabaseStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseCluster
  public readonly vpc: ec2.Vpc

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    this.vpc = new ec2.Vpc(this, 'PegasusVpc', {
      maxAzs: 2,
      natGateways: 1,
    })

    this.cluster = new rds.DatabaseCluster(this, 'PegasusDatabase', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4,
      }),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 4,
      writer: rds.ClusterInstance.serverlessV2('writer'),
      vpc: this.vpc,
      defaultDatabaseName: 'pegasus',
      storageEncrypted: true,
    })

    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
      exportName: 'PegasusDbEndpoint',
    })
  }
}
