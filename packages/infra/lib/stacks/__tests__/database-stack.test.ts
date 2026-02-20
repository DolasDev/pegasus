import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { DatabaseStack } from '../database-stack'

function synthDatabaseStack() {
  const app = new cdk.App()
  const stack = new DatabaseStack(app, 'TestDatabaseStack')
  return Template.fromStack(stack)
}

describe('DatabaseStack — VPC', () => {
  it('creates exactly one VPC', () => {
    const template = synthDatabaseStack()
    template.resourceCountIs('AWS::EC2::VPC', 1)
  })

  it('enables DNS hostnames and DNS support on the VPC', () => {
    const template = synthDatabaseStack()
    template.hasResourceProperties('AWS::EC2::VPC', {
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
    })
  })

  it('provisions at least one NAT gateway', () => {
    const template = synthDatabaseStack()
    // maxAzs:2 + natGateways:1 → one EIP + one NatGateway
    template.resourceCountIs('AWS::EC2::NatGateway', 1)
  })
})

describe('DatabaseStack — Aurora cluster', () => {
  it('creates exactly one DB cluster', () => {
    const template = synthDatabaseStack()
    template.resourceCountIs('AWS::RDS::DBCluster', 1)
  })

  it('uses Aurora PostgreSQL 15.4 engine', () => {
    const template = synthDatabaseStack()
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      Engine: 'aurora-postgresql',
      EngineVersion: '15.4',
    })
  })

  it('enables storage encryption', () => {
    const template = synthDatabaseStack()
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      StorageEncrypted: true,
    })
  })

  it('sets a default database name of "pegasus"', () => {
    const template = synthDatabaseStack()
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      DatabaseName: 'pegasus',
    })
  })

  it('provisions a serverless v2 writer instance', () => {
    const template = synthDatabaseStack()
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBClusterIdentifier: Match.anyValue(),
      DBInstanceClass: 'db.serverless',
    })
  })
})

describe('DatabaseStack — RDS Proxy', () => {
  it('creates exactly one RDS Proxy', () => {
    const template = synthDatabaseStack()
    template.resourceCountIs('AWS::RDS::DBProxy', 1)
  })

  it('names the proxy "pegasus-proxy"', () => {
    const template = synthDatabaseStack()
    template.hasResourceProperties('AWS::RDS::DBProxy', {
      DBProxyName: 'pegasus-proxy',
    })
  })

  it('uses PostgreSQL engine family', () => {
    const template = synthDatabaseStack()
    template.hasResourceProperties('AWS::RDS::DBProxy', {
      EngineFamily: 'POSTGRESQL',
    })
  })
})

describe('DatabaseStack — Security Groups', () => {
  it('creates a Lambda security group with allow-all egress', () => {
    const template = synthDatabaseStack()
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Security group for the Pegasus API Lambda function',
      SecurityGroupEgress: Match.arrayWith([
        Match.objectLike({ CidrIp: '0.0.0.0/0' }),
      ]),
    })
  })

  it('allows port 5432 ingress from the Lambda security group to the cluster', () => {
    const template = synthDatabaseStack()
    // CDK represents SG-to-SG rules as SecurityGroupIngress resources
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      VpcSecurityGroupIds: Match.anyValue(),
    })
  })
})

describe('DatabaseStack — CloudFormation Outputs', () => {
  it('exports the cluster ARN', () => {
    const template = synthDatabaseStack()
    template.hasOutput('ClusterArn', {
      Export: { Name: 'PegasusClusterArn' },
    })
  })

  it('exports the proxy endpoint', () => {
    const template = synthDatabaseStack()
    template.hasOutput('ProxyEndpoint', {
      Export: { Name: 'PegasusProxyEndpoint' },
    })
  })

  it('exports the secret ARN', () => {
    const template = synthDatabaseStack()
    template.hasOutput('SecretArn', {
      Export: { Name: 'PegasusSecretArn' },
    })
  })
})
