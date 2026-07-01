import { describe, it, expect } from 'vitest'
import { hasPrimaryContact } from '@pegasus/domain'
import { mapPegiiCustomerToDomain } from '../pegii-customer.mapper'
import {
  happyPathCustomer,
  missingEmailCustomer,
  noContactsCustomer,
  noPrimaryContactCustomer,
} from '../__fixtures__/pegii-customer.fixtures'

describe('mapPegiiCustomerToDomain', () => {
  it('maps a full happy-path DTO into a domain Customer', () => {
    const c = mapPegiiCustomerToDomain(happyPathCustomer, 'pegii-system')
    expect(c.id).toBe('1001')
    expect(c.userId).toBe('pegii-system')
    expect(c.firstName).toBe('Ada')
    expect(c.email).toBe('ada@acme.example')
    expect(c.phone).toBe('+15551230001')
    expect(c.accountId).toBe('1001') // companyName present ⇒ accountId set
    expect(c.leadSourceId).toBe('LEAD-77')
    expect(c.contacts).toHaveLength(1)
    expect(c.contacts[0]).toMatchObject({ id: '5001', customerId: '1001', isPrimary: true })
    expect(hasPrimaryContact(c)).toBe(true)
  })

  it('falls back to empty-string email and omits absent optional fields', () => {
    const c = mapPegiiCustomerToDomain(missingEmailCustomer, 'pegii-system')
    expect(c.email).toBe('')
    expect(c.contacts[0]!.email).toBe('')
    expect('phone' in c).toBe(false)
    expect('accountId' in c).toBe(false) // no companyName
    expect('leadSourceId' in c).toBe(false) // no leadNumber
  })

  it('defaults a missing contacts array to []', () => {
    const c = mapPegiiCustomerToDomain(noContactsCustomer, 'pegii-system')
    expect(c.contacts).toEqual([])
    expect(hasPrimaryContact(c)).toBe(false)
  })

  it('produces a Customer where hasPrimaryContact is false when no contact is primary', () => {
    const c = mapPegiiCustomerToDomain(noPrimaryContactCustomer, 'pegii-system')
    expect(c.contacts).toHaveLength(2)
    // This is what keeps the existing /:customerId/quotes 422 guard correct.
    expect(hasPrimaryContact(c)).toBe(false)
  })

  it('uses epoch timestamps until pegII exposes audit fields', () => {
    const c = mapPegiiCustomerToDomain(happyPathCustomer, 'pegii-system')
    expect(c.createdAt.getTime()).toBe(0)
    expect(c.updatedAt.getTime()).toBe(0)
  })
})
