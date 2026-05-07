#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// One-shot migration: rebuild an AVP policy store to the attribute-based
// authz model.
//
// Replaces:
//   - the on-AVP schema (User now has cognito:groups Set<String> attribute,
//     no Group memberOfTypes)
//   - the seven Cedar policies (attribute-based `principal["cognito:groups"]
//     .contains("X")` instead of group-hierarchy `principal in
//     Pegasus::Group::"X"`)
//   - the IdentitySource (drop `groupConfiguration` so AVP stops synthesising
//     prefixed Group entities and instead projects `cognito:groups` onto the
//     principal as a Set<String> attribute)
//
// Idempotent — safe to re-run. If a step has already been applied the
// underlying API treats it as a no-op (PutSchema overwrites; CreatePolicy
// runs against an empty store after the delete pass; UpdateIdentitySource
// applies the desired state regardless of current state).
//
// Usage:
//   npx tsx apps/api/src/scripts/migrate-policy-store.ts <policyStoreId>
//
// Auth: standard AWS SDK credential chain. For staging:
//   AWS_PROFILE=pegasus-staging AWS_REGION=us-east-1 \
//     npx tsx apps/api/src/scripts/migrate-policy-store.ts KRzp8Jrxxkvy3YGnkeYQBP
// ---------------------------------------------------------------------------

import {
  VerifiedPermissionsClient,
  ListPoliciesCommand,
  DeletePolicyCommand,
  PutSchemaCommand,
  CreatePolicyCommand,
  ListIdentitySourcesCommand,
  UpdateIdentitySourceCommand,
  GetSchemaCommand,
} from '@aws-sdk/client-verifiedpermissions'
import { loadPolicies, loadSchemaJson } from '../authz/load'

// Same backoff shape as lib/authz-provision.ts withConsistencyRetry. Inlined
// here to avoid pulling in the Prisma-touching provisioning module.
async function withConsistencyRetry<T>(fn: () => Promise<T>, maxAttempts = 6): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const name = (err as { name?: string }).name
      if (name !== 'ResourceNotFoundException' || attempt === maxAttempts) {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)))
    }
  }
  throw lastErr
}

async function main(): Promise<void> {
  const policyStoreId = process.argv[2]
  if (!policyStoreId) {
    console.error('Usage: migrate-policy-store.ts <policyStoreId>')
    process.exit(1)
  }

  const avp = new VerifiedPermissionsClient({})

  console.log(`=== Migrating policy store ${policyStoreId} ===`)

  // 1) Delete every existing policy. ListPolicies paginates, so loop until
  //    nextToken comes back undefined.
  let nextToken: string | undefined
  let deleted = 0
  do {
    const page = await avp.send(new ListPoliciesCommand({ policyStoreId, nextToken }))
    for (const p of page.policies ?? []) {
      if (!p.policyId) continue
      const policyId = p.policyId
      await withConsistencyRetry(() =>
        avp.send(new DeletePolicyCommand({ policyStoreId, policyId })),
      )
      deleted++
    }
    nextToken = page.nextToken
  } while (nextToken)
  console.log(`  deleted ${deleted} existing polic${deleted === 1 ? 'y' : 'ies'}`)

  // 2) PutSchema with the on-disk schema. Overwrites whatever the store
  //    currently has (e.g. the e94c3dc Group.memberOfTypes=["Group"] PutSchema).
  await withConsistencyRetry(() =>
    avp.send(
      new PutSchemaCommand({
        policyStoreId,
        definition: { cedarJson: loadSchemaJson() },
      }),
    ),
  )
  console.log('  schema updated')

  // 3) Create each rewritten policy.
  const policies = loadPolicies()
  for (const p of policies) {
    await withConsistencyRetry(() =>
      avp.send(
        new CreatePolicyCommand({
          policyStoreId,
          definition: {
            static: { description: p.name, statement: p.statement },
          },
        }),
      ),
    )
  }
  console.log(`  created ${policies.length} polic${policies.length === 1 ? 'y' : 'ies'}`)

  // 4) Update every IdentitySource to drop groupConfiguration. AVP only
  //    supports one Cognito IdentitySource per store today, but loop to be
  //    defensive against future multi-source support.
  let identitySourceCount = 0
  let isNextToken: string | undefined
  do {
    const page = await avp.send(
      new ListIdentitySourcesCommand({ policyStoreId, nextToken: isNextToken }),
    )
    for (const src of page.identitySources ?? []) {
      if (!src.identitySourceId) continue
      const identitySourceId = src.identitySourceId
      // ListIdentitySources still surfaces userPoolArn/clientIds on the
      // deprecated top-level `details` shape; the newer `configuration`
      // shape only ships on GetIdentitySource. Either is sufficient for
      // determining the current Cognito wiring.
      const userPoolArn = src.details?.userPoolArn
      const clientIds = src.details?.clientIds
      if (!userPoolArn || !clientIds) {
        throw new Error(
          `Identity source ${identitySourceId} is not a Cognito user-pool source — aborting`,
        )
      }
      await withConsistencyRetry(() =>
        avp.send(
          new UpdateIdentitySourceCommand({
            policyStoreId,
            identitySourceId,
            // principalEntityType must be passed on every Update call —
            // AVP defaults it to `AWS::Cognito` when omitted, which would
            // produce principals our schema/policies don't recognise. The
            // value here mirrors what authz-provision.ts:CreateIdentitySource
            // sets at provision time.
            principalEntityType: 'Pegasus::User',
            updateConfiguration: {
              cognitoUserPoolConfiguration: {
                userPoolArn,
                clientIds,
                // Explicitly omit `groupConfiguration` to clear any prior
                // value — Update applies the configuration as-is.
              },
            },
          }),
        ),
      )
      identitySourceCount++
    }
    isNextToken = page.nextToken
  } while (isNextToken)
  console.log(
    `  updated ${identitySourceCount} identity source${identitySourceCount === 1 ? '' : 's'}`,
  )

  // 5) Verify: pull the schema back and confirm User.memberOfTypes includes
  //    Group — this is the entity-hierarchy contract the IsAuthorized path
  //    relies on. Both backends construct User entities with Group parents
  //    from principal.roleNames; the schema must permit that parenthood.
  const schemaResult = await avp.send(new GetSchemaCommand({ policyStoreId }))
  const schema = JSON.parse(schemaResult.schema ?? '{}')
  const userMemberOf = schema?.Pegasus?.entityTypes?.User?.memberOfTypes
  if (!Array.isArray(userMemberOf) || !userMemberOf.includes('Group')) {
    throw new Error(
      `Post-migration schema does not have User.memberOfTypes=["Group"]: ${JSON.stringify(userMemberOf)}`,
    )
  }

  console.log('=== Migration complete ===')
  console.log(`  policyStoreId:    ${policyStoreId}`)
  console.log(`  policies:         ${policies.length}`)
  console.log(`  identity sources: ${identitySourceCount}`)
  console.log(`  schema User.memberOfTypes: ${JSON.stringify(userMemberOf)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
