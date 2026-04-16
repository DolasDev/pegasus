#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// One-shot migration: rename existing document S3 keys from the flat layout
// `{tenantId}/{entityType}/{entityId}/{documentId}/{filename}` to the new
// `{tenantId}/{entityType}/{entityId}/{documentId}/original/{filename}` layout.
//
// Usage:
//   npx tsx scripts/migrate-document-keys.ts              # dry-run (default)
//   npx tsx scripts/migrate-document-keys.ts --apply      # actually migrate
//
// Idempotent: skips rows whose s3Key already contains `/original/`.
// ---------------------------------------------------------------------------

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

const DRY_RUN = !process.argv.includes('--apply')

async function main() {
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const adapter = new PrismaPg({ connectionString })
  const db = new PrismaClient({ adapter })
  const s3 = new S3Client({})

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== APPLYING MIGRATION ===')

  const documents = await db.document.findMany({
    select: { id: true, s3Bucket: true, s3Key: true },
  })

  let migrated = 0
  let skipped = 0
  let failed = 0

  for (const doc of documents) {
    if (doc.s3Key.includes('/original/')) {
      skipped++
      continue
    }

    // Current: {tenant}/{type}/{entityId}/{docId}/{filename}
    // Target:  {tenant}/{type}/{entityId}/{docId}/original/{filename}
    const parts = doc.s3Key.split('/')
    if (parts.length < 5) {
      console.warn(`Unexpected key format, skipping: ${doc.s3Key}`)
      skipped++
      continue
    }

    const filename = parts.pop()!
    const newKey = [...parts, 'original', filename].join('/')

    console.log(`  ${doc.id}: ${doc.s3Key} → ${newKey}`)

    if (!DRY_RUN) {
      try {
        await s3.send(
          new CopyObjectCommand({
            Bucket: doc.s3Bucket,
            CopySource: `${doc.s3Bucket}/${doc.s3Key}`,
            Key: newKey,
          }),
        )

        await db.document.update({
          where: { id: doc.id },
          data: { s3Key: newKey },
        })

        await s3.send(
          new DeleteObjectCommand({
            Bucket: doc.s3Bucket,
            Key: doc.s3Key,
          }),
        )

        migrated++
      } catch (err) {
        console.error(`  FAILED ${doc.id}:`, err)
        failed++
      }
    } else {
      migrated++
    }
  }

  console.log(
    `\nTotal: ${documents.length}, migrated: ${migrated}, skipped: ${skipped}, failed: ${failed}`,
  )
  if (DRY_RUN) console.log('Re-run with --apply to execute.')

  await db.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
