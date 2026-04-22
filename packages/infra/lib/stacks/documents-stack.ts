// ---------------------------------------------------------------------------
// DocumentsStack
//
// Owns the S3 bucket used by the document management system and the converter
// Lambda that generates thumbnail/web variants from uploaded originals.
//
// The converter Lambda is triggered by S3 ObjectCreated events. It filters
// for keys containing `/original/` (mid-key segment — S3 prefix filters
// can't match this, so the filter runs in the Lambda itself).
// ---------------------------------------------------------------------------

import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3n from 'aws-cdk-lib/aws-s3-notifications'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { type Construct } from 'constructs'

export class DocumentsStack extends cdk.Stack {
  public readonly bucket: s3.IBucket

  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props)

    const bucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: `pegasus-documents-${cdk.Stack.of(this).account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
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
        },
      ],
    })

    this.bucket = bucket

    // ---------------------------------------------------------------------------
    // Converter Lambda — generates thumb + web variants from uploaded originals
    // ---------------------------------------------------------------------------

    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'NeonDatabaseUrl',
      'pegasus/dev/database-url',
    )

    const converterLogGroup = new logs.LogGroup(this, 'ConverterLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const converterFn = new nodejs.NodejsFunction(this, 'ConverterFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-document-converter.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
        LOG_LEVEL: 'INFO',
        DOCUMENTS_BUCKET_NAME: bucket.bucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', 'sharp', '@napi-rs/canvas'],
        nodeModules: ['sharp', '@napi-rs/canvas'],
      },
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      logGroup: converterLogGroup,
    })

    dbSecret.grantRead(converterFn)
    bucket.grantRead(converterFn)
    bucket.grantPut(converterFn)

    // S3 prefix filters only match from the start of the key, so we can't
    // filter on the mid-key `/original/` segment. The Lambda handler itself
    // skips non-original keys (see lambda-document-converter.ts).
    bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(converterFn))

    // ---------------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------------

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
