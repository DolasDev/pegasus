// ---------------------------------------------------------------------------
// Guards that the PUBLISHED mapping schema (the static file in docs/schemas and
// the GET endpoint) stays in sync with the code's single source of truth. If
// someone changes the mapping format without regenerating the file, this fails.
// Regenerate with:
//   npx tsx -e "import {writeFileSync} from 'node:fs';
//     import {mappingFormatJsonSchema} from './src/integration-validation/transform/mapping-format.ts';
//     writeFileSync('../../docs/schemas/integration-mapping.schema.json',
//       JSON.stringify(mappingFormatJsonSchema(), null, 2)+'\n')"
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mappingFormatJsonSchema, MAPPING_FORMAT_SCHEMA_ID } from './mapping-format'

// vitest runs with cwd = the apps/api package root.
const publishedPath = join(process.cwd(), '../../docs/schemas/integration-mapping.schema.json')

describe('published mapping schema', () => {
  it('the committed docs/schemas file matches the generated schema', () => {
    const onDisk = JSON.parse(readFileSync(publishedPath, 'utf8'))
    expect(onDisk).toEqual(mappingFormatJsonSchema())
  })

  it('carries a stable $id (bumped only on a breaking format change)', () => {
    expect(mappingFormatJsonSchema()['$id']).toBe(MAPPING_FORMAT_SCHEMA_ID)
  })
})
