// ---------------------------------------------------------------------------
// E2EStagingRoleStack
//
// Provisions a narrow IAM role that the GH Actions e2e-staging gate assumes
// via OIDC to mint per-persona test sessions in the staging Cognito pool.
//
// The persona-coverage tests in apps/e2e/tests/api/authz-smoke.spec.ts call
// AdminSetUserPassword directly against the user pool to bypass the Cognito
// FORCE_CHANGE_PASSWORD challenge that AdminCreateUser leaves on invitee
// accounts. That admin API requires AWS credentials, which the e2e runner
// previously did not have. Reusing the deploy role would have worked but
// widens that role's blast radius to a whole class of admin Cognito calls;
// instead this stack ships a single-purpose role scoped to one action on
// one user pool.
//
// Only instantiated for the staging env — see bin/app.ts.
// ---------------------------------------------------------------------------

import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import { type Construct } from 'constructs'

export interface E2EStagingRoleStackProps extends cdk.StackProps {
  readonly userPoolArn: string
  readonly githubRepo: string
}

export class E2EStagingRoleStack extends cdk.Stack {
  public readonly role: iam.IRole

  constructor(scope: Construct, id: string, props: E2EStagingRoleStackProps) {
    super(scope, id, props)

    // The GitHub OIDC provider already exists in the staging account (it was
    // created out-of-band when the deploy role was set up). Reference it by
    // its conventional ARN rather than re-creating it, which would conflict.
    const oidcProviderArn = `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`

    const role = new iam.Role(this, 'Role', {
      roleName: 'pegasus-github-actions-e2e-staging',
      description:
        'Assumed by the pegasus GH Actions e2e-staging gate to mint persona Cognito sessions.',
      assumedBy: new iam.FederatedPrincipal(
        oidcProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            // Restrict to the staging environment of this repo only — same
            // trust pattern as the deploy role.
            'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:environment:staging`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      maxSessionDuration: cdk.Duration.hours(1),
    })

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminSetUserPassword'],
        resources: [props.userPoolArn],
      }),
    )

    this.role = role

    new cdk.CfnOutput(this, 'E2ERoleArn', {
      value: role.roleArn,
      description: 'IAM role assumed by the e2e-staging GH Actions gate.',
      exportName: 'PegasusE2EStagingRoleArn',
    })
  }
}
