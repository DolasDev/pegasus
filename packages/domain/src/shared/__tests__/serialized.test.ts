import { describe, it, expectTypeOf } from 'vitest'
import type { Serialized } from '../types'
import type { Customer, Contact } from '../../customer/index'
import type { Move } from '../../dispatch/index'
import type { Quote } from '../../quoting/index'
import type { Invoice } from '../../billing/index'
import type { InventoryRoom, InventoryItem } from '../../inventory/index'

// ---------------------------------------------------------------------------
// Serialized<T> — type-level tests
// ---------------------------------------------------------------------------

describe('Serialized<T>', () => {
  it('maps Customer.createdAt from Date to string', () => {
    expectTypeOf<Serialized<Customer>['createdAt']>().toEqualTypeOf<string>()
  })

  it('maps Customer.updatedAt from Date to string', () => {
    expectTypeOf<Serialized<Customer>['updatedAt']>().toEqualTypeOf<string>()
  })

  it('maps Customer.id from CustomerId (branded) to string', () => {
    expectTypeOf<Serialized<Customer>['id']>().toEqualTypeOf<string>()
  })

  it('maps nested Contact.id from ContactId (branded) to string', () => {
    expectTypeOf<Serialized<Customer>['contacts'][number]['id']>().toEqualTypeOf<string>()
  })

  it('preserves non-date, non-branded fields on Customer', () => {
    expectTypeOf<Serialized<Customer>['firstName']>().toEqualTypeOf<string>()
    expectTypeOf<Serialized<Customer>['email']>().toEqualTypeOf<string>()
  })

  it('maps Move.scheduledDate from Date to string', () => {
    expectTypeOf<Serialized<Move>['scheduledDate']>().toEqualTypeOf<string>()
  })

  it('maps Move.createdAt from Date to string', () => {
    expectTypeOf<Serialized<Move>['createdAt']>().toEqualTypeOf<string>()
  })

  it('maps Move.id from MoveId (branded) to string', () => {
    expectTypeOf<Serialized<Move>['id']>().toEqualTypeOf<string>()
  })

  it('maps Quote.validUntil from Date to string', () => {
    expectTypeOf<Serialized<Quote>['validUntil']>().toEqualTypeOf<string>()
  })

  it('maps Quote.createdAt from Date to string', () => {
    expectTypeOf<Serialized<Quote>['createdAt']>().toEqualTypeOf<string>()
  })

  it('maps Invoice.createdAt from Date to string', () => {
    expectTypeOf<Serialized<Invoice>['createdAt']>().toEqualTypeOf<string>()
  })

  it('maps Invoice.updatedAt from Date to string', () => {
    expectTypeOf<Serialized<Invoice>['updatedAt']>().toEqualTypeOf<string>()
  })

  it('preserves primitive number fields', () => {
    expectTypeOf<Serialized<InventoryItem>['quantity']>().toEqualTypeOf<number>()
  })

  it('preserves boolean fields on Contact', () => {
    expectTypeOf<Serialized<Contact>['isPrimary']>().toEqualTypeOf<boolean>()
  })

  it('maps InventoryRoom.id from branded to string', () => {
    expectTypeOf<Serialized<InventoryRoom>['id']>().toEqualTypeOf<string>()
  })

  it('maps nested InventoryItem.id inside InventoryRoom.items', () => {
    expectTypeOf<Serialized<InventoryRoom>['items'][number]['id']>().toEqualTypeOf<string>()
  })

  it('maps arrays of domain types correctly', () => {
    expectTypeOf<Serialized<Customer[]>[number]['id']>().toEqualTypeOf<string>()
    expectTypeOf<Serialized<Customer[]>[number]['createdAt']>().toEqualTypeOf<string>()
  })

  it('preserves Money value object shape (no dates or brands inside)', () => {
    expectTypeOf<Serialized<Quote>['price']['amount']>().toEqualTypeOf<number>()
    expectTypeOf<Serialized<Quote>['price']['currency']>().toEqualTypeOf<string>()
  })
})
