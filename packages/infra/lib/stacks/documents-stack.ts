// ---------------------------------------------------------------------------
// DocumentsStack
//
// Owns the S3 bucket used by the document management system. Kept in its own
// stack so the bucket lifecycle (RETAIN) is decoupled from the API Lambda
// stack and so cross-stack wiring stays explicit. ApiStack receives this
// bucket via props and grants the Lambda role read/write/delete.
// ---------------------------------------------------------------------------

import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { type Construct } from 'constructs'

export class DocumentsStack extends cdk.Stack {
  public readonly bucket: s3.IBucket

  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props)

    const bucket = new s3.Bucket(this, 'DocumentsBucket', {
      // Bucket names must be globally unique — qualify with account + region.
      bucketName: `pegasus-documents-${cdk.Stack.of(this).account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      // RETAIN protects against accidental data loss when the stack is destroyed.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'], // tightened to app domains in a follow-up
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'transition-to-intelligent-tiering',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          // Intentionally no expiration rule — deletion is app-controlled
          // via the soft-delete + future hard-delete-worker flow.
        },
      ],
    })

    this.bucket = bucket

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: bucket.bucketName,
      exportName: 'PegasusDocumentsBucketName',
    })
    new cdk.CfnOutput(this, 'DocumentsBucketArn', {
      value: bucket.bucketArn,
      exportName: 'PegasusDocumentsBucketArn',
    })
  }
}
