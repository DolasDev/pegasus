import { describe, it } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { DocumentsStack } from '../documents-stack'

function synth() {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
  const stack = new DocumentsStack(app, 'TestDocuments', {
    env: { account: '111111111111', region: 'us-east-1' },
  })
  return Template.fromStack(stack)
}

describe('DocumentsStack — bucket', () => {
  it('creates exactly one S3 bucket', () => {
    synth().resourceCountIs('AWS::S3::Bucket', 1)
  })

  it('blocks all public access', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })
  })

  it('enables server-side encryption with S3-managed keys', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
          }),
        ]),
      },
    })
  })

  it('enables versioning', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
    })
  })

  it('configures CORS for PUT/GET/HEAD', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedMethods: Match.arrayWith(['PUT', 'GET', 'HEAD']),
          }),
        ]),
      },
    })
  })

  it('transitions objects to INTELLIGENT_TIERING after 90 days', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Status: 'Enabled',
            Transitions: Match.arrayWith([
              Match.objectLike({
                StorageClass: 'INTELLIGENT_TIERING',
                TransitionInDays: 90,
              }),
            ]),
          }),
        ]),
      },
    })
  })

  it('enforces SSL via a bucket policy', () => {
    synth().hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    })
  })

  it('uses RETAIN removal policy on the bucket', () => {
    synth().hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    })
  })

  it('exports the bucket name and ARN', () => {
    const t = synth()
    t.hasOutput('DocumentsBucketName', { Export: { Name: 'PegasusDocumentsBucketName' } })
    t.hasOutput('DocumentsBucketArn', { Export: { Name: 'PegasusDocumentsBucketArn' } })
  })
})
