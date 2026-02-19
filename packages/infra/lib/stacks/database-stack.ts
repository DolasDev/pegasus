import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { type Construct } from 'constructs'

export class DatabaseStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseCluster
  public readonly vpc: ec2.Vpc
  public readonly proxy: rds.DatabaseProxy
  public readonly secret: secretsmanager.ISecret
  /**
   * Pre-created security group to be used by the API Lambda function.
   * Defined here so the cluster/proxy ingress rules don't create a
   * cross-stack security group reference cycle.
   */
  public readonly lambdaSecurityGroup: ec2.SecurityGroup

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
      credentials: rds.Credentials.fromGeneratedSecret('postgres'),
    })

    // cluster.secret is defined because we used fromGeneratedSecret above
    this.secret = this.cluster.secret!

    this.proxy = new rds.DatabaseProxy(this, 'PegasusProxy', {
      proxyTarget: rds.ProxyTarget.fromCluster(this.cluster),
      secrets: [this.secret],
      vpc: this.vpc,
      dbProxyName: 'pegasus-proxy',
      requireTLS: false,
    })

    // Security group for the API Lambda — created here to avoid cross-stack
    // SG reference cycles when authorising inbound rules on the cluster/proxy.
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for the Pegasus API Lambda function',
      allowAllOutbound: true,
    })

    // Allow Lambda SG to connect to the Aurora cluster and the proxy on 5432
    this.cluster.connections.allowFrom(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Lambda to Aurora cluster',
    )
    this.proxy.connections.allowFrom(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Lambda to RDS Proxy',
    )

    // ---------------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ClusterArn', {
      value: this.cluster.clusterArn,
      exportName: 'PegasusClusterArn',
    })

    new cdk.CfnOutput(this, 'ProxyEndpoint', {
      value: this.proxy.endpoint,
      exportName: 'PegasusProxyEndpoint',
    })

    new cdk.CfnOutput(this, 'SecretArn', {
      value: this.secret.secretArn,
      exportName: 'PegasusSecretArn',
    })
  }
}
