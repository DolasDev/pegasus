import * as Contacts from 'expo-contacts'
import { loadPhoneContacts, toCandidates } from './laborContacts'

const granted = (accessPrivileges: 'all' | 'limited' = 'all') => ({
  status: 'granted',
  granted: true,
  canAskAgain: true,
  accessPrivileges,
})
const denied = (canAskAgain: boolean) => ({
  status: 'denied',
  granted: false,
  canAskAgain,
  accessPrivileges: 'none',
})

const contact = (partial: Record<string, unknown>) =>
  ({ id: 'c1', contactType: 'person', name: 'Ace Movers', ...partial }) as Contacts.ExistingContact

describe('toCandidates', () => {
  it('normalises numbers, puts the mobile first, de-duplicates, and drops bad ones', () => {
    const [c] = toCandidates([
      contact({
        phoneNumbers: [
          { label: 'work', number: '(404) 555-0102' },
          { label: 'mobile', number: '404.555.0101' },
          { label: 'home', number: '+1 404 555 0102' },
          { label: 'other', number: '911' },
        ],
        emails: [{ label: 'work', email: '  ace@example.com ' }],
      }),
    ])
    expect(c!.numbers.map((n) => [n.label, n.e164])).toEqual([
      ['mobile', '+14045550101'],
      ['work', '+14045550102'],
    ])
    expect(c!.numbers[0]!.display).toBe('(404) 555-0101')
    expect(c!.email).toBe('ace@example.com')
  })

  it('skips contacts without a usable number, falls back to the number as the name, sorts by name', () => {
    const out = toCandidates([
      contact({ id: 'a', name: 'Zed', phoneNumbers: [{ label: 'mobile', digits: '4045550103' }] }),
      contact({ id: 'b', name: 'Nobody', phoneNumbers: [{ label: 'mobile', number: '12' }] }),
      contact({ id: 'c', name: '  ', phoneNumbers: [{ label: '', number: '4045550104' }] }),
      contact({ id: 'd', name: 'Empty' }),
    ])
    expect(out.map((c) => [c.id, c.name, c.email])).toEqual([
      ['c', '(404) 555-0104', null],
      ['a', 'Zed', null],
    ])
    expect(out[0]!.numbers[0]!.label).toBe('phone')
  })
})

describe('loadPhoneContacts', () => {
  const getPermissions = Contacts.getPermissionsAsync as jest.Mock
  const requestPermissions = Contacts.requestPermissionsAsync as jest.Mock
  const getContacts = Contacts.getContactsAsync as jest.Mock

  it('reads the address book with full access', async () => {
    getPermissions.mockResolvedValueOnce(granted())
    getContacts.mockResolvedValueOnce({
      data: [contact({ phoneNumbers: [{ label: 'mobile', number: '4045550101' }] })],
    })
    const res = await loadPhoneContacts()
    expect(res.access).toBe('all')
    expect(res.contacts).toHaveLength(1)
    expect(requestPermissions).not.toHaveBeenCalled()
  })

  it('asks when it may, and reports limited (iOS 18) access', async () => {
    getPermissions.mockResolvedValueOnce(denied(true))
    requestPermissions.mockResolvedValueOnce(granted('limited'))
    getContacts.mockResolvedValueOnce({ data: [] })
    expect((await loadPhoneContacts()).access).toBe('limited')
  })

  it('reports denied without reading contacts', async () => {
    getPermissions.mockResolvedValueOnce(denied(false))
    const res = await loadPhoneContacts()
    expect(res).toEqual({ access: 'denied', canAskAgain: false, contacts: [] })
    expect(requestPermissions).not.toHaveBeenCalled()
    expect(getContacts).not.toHaveBeenCalled()
  })
})
