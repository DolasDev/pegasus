// ---------------------------------------------------------------------------
// Drift detector for the role-options catalog.
//
// Asserts the names declared in `authz/role-options.ts` line up with the
// Cedar policy files on disk:
//
//   - `tenant_admin`               → policies/10-tenant-admin.cedar
//   - `tenant_user`                → policies/20-tenant-user.cedar
//   - every persona in 30-personas → an entry in ROLE_OPTIONS
//
// Catches the "I added sales-manager.cedar but forgot to expose it" class of
// regression that the persona E2E spec wouldn't (the spec only exercises the
// personas it knows about). The reverse is also caught: a stale entry in the
// catalog with no backing policy would mean a tenant admin could "assign" a
// role that grants nothing — confusing and silently broken.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROLE_OPTIONS } from '../role-options'

const POLICIES_DIR = join(__dirname, '..', 'policies')
const PERSONAS_DIR = join(POLICIES_DIR, '30-personas')

/** Convert a policy filename like `crew-lead.cedar` → `crew_lead`. */
function fileToPersonaName(file: string): string {
  return file.replace(/\.cedar$/, '').replace(/-/g, '_')
}

describe('role-options catalog ↔ Cedar policy files', () => {
  it('contains tenant_admin and tenant_user with their policy files present', () => {
    expect(ROLE_OPTIONS.find((r) => r.name === 'tenant_admin')).toBeDefined()
    expect(ROLE_OPTIONS.find((r) => r.name === 'tenant_user')).toBeDefined()

    const tenantAdminPolicy = readFileSync(join(POLICIES_DIR, '10-tenant-admin.cedar'), 'utf8')
    const tenantUserPolicy = readFileSync(join(POLICIES_DIR, '20-tenant-user.cedar'), 'utf8')
    expect(tenantAdminPolicy).toMatch(/Pegasus::Group::"tenant_admin"/)
    expect(tenantUserPolicy).toMatch(/Pegasus::Group::"tenant_user"/)
  })

  it('every persona policy has a matching role-options entry', () => {
    const personaFiles = readdirSync(PERSONAS_DIR).filter((f) => f.endsWith('.cedar'))
    const expectedNames = personaFiles.map(fileToPersonaName).sort()
    const catalogPersonaNames = ROLE_OPTIONS.map((r) => r.name)
      .filter((n) => n !== 'tenant_admin' && n !== 'tenant_user')
      .sort()
    expect(catalogPersonaNames).toEqual(expectedNames)
  })

  it('every persona role-options entry references the persona group in its policy', () => {
    const personaFiles = readdirSync(PERSONAS_DIR).filter((f) => f.endsWith('.cedar'))
    const personasInCatalog = ROLE_OPTIONS.filter(
      (r) => r.name !== 'tenant_admin' && r.name !== 'tenant_user',
    )
    for (const opt of personasInCatalog) {
      const file = personaFiles.find((f) => fileToPersonaName(f) === opt.name)
      expect(file, `no .cedar policy for ${opt.name}`).toBeDefined()
      const body = readFileSync(join(PERSONAS_DIR, file!), 'utf8')
      expect(body).toMatch(new RegExp(`Pegasus::Group::"${opt.name}"`))
    }
  })

  it('every entry has unique name, label, and a non-empty description', () => {
    const names = ROLE_OPTIONS.map((r) => r.name)
    expect(new Set(names).size).toBe(names.length)
    for (const r of ROLE_OPTIONS) {
      expect(r.label.trim().length).toBeGreaterThan(0)
      expect(r.description.trim().length).toBeGreaterThan(0)
    }
  })
})
