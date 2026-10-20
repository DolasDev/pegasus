import { describe, it, expect } from 'vitest'
import { DomainError } from '../../shared/errors'
import {
  normalizePhoneNumber,
  formatPhoneNumber,
  foldKey,
  validateCrew,
  normalizeNickname,
  validatePacker,
  validateRating,
  aggregateRating,
  countryOfRegion,
  validateServiceAreas,
  parseLocationQuery,
  rankCrewsByDistance,
  crewsToVCard,
  crewsToGoogleContactsCsv,
  GOOGLE_CONTACTS_CSV_HEADERS,
  MAX_SERVICE_AREAS,
  type ExportCrew,
} from '../index'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    if (err instanceof DomainError) return err.code
    throw err
  }
  return undefined
}

const TODAY = '2026-10-20'

describe('normalizePhoneNumber', () => {
  it.each([
    ['(404) 555-1212', '+14045551212'],
    ['404.555.1212', '+14045551212'],
    ['404-555-1212', '+14045551212'],
    ['1-404-555-1212', '+14045551212'],
    ['+1 404 555 1212', '+14045551212'],
    ['14045551212', '+14045551212'],
    ['(416) 555-0199', '+14165550199'],
    ['404-555-1212 x123', '+14045551212'],
    ['404-555-1212 ext. 9', '+14045551212'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('normalises %s', (raw, expected) => {
    expect(normalizePhoneNumber(raw)).toBe(expected)
  })

  it.each(['', '555-1212', '123-456-7890', '(404) 155-1212', 'call me', '+0 123', '04045551212'])(
    'rejects %s',
    (raw) => {
      expect(codeOf(() => normalizePhoneNumber(raw))).toBe('INVALID_PHONE_NUMBER')
    },
  )

  it('formats NANP numbers for display and leaves others alone', () => {
    expect(formatPhoneNumber('+14045551212')).toBe('(404) 555-1212')
    expect(formatPhoneNumber('+442079460958')).toBe('+442079460958')
  })
})

describe('foldKey', () => {
  it('lowercases, strips accents and punctuation, collapses spaces', () => {
    expect(foldKey('  Montréal ')).toBe('montreal')
    expect(foldKey("St. John's")).toBe('st john s')
    expect(foldKey('Winston-Salem')).toBe('winston salem')
  })
})

describe('validateCrew', () => {
  it('normalises phone, name and email', () => {
    expect(validateCrew({ phone: '404 555 1212', name: ' Juan Crew ', email: 'A@B.com ' })).toEqual(
      { phone: '+14045551212', name: 'Juan Crew', email: 'a@b.com' },
    )
  })

  it('requires a name', () => {
    expect(codeOf(() => validateCrew({ phone: '4045551212', name: '  ' }))).toBe(
      'LABOR_FIELD_REQUIRED',
    )
  })

  it('rejects a bad email', () => {
    expect(codeOf(() => validateCrew({ phone: '4045551212', name: 'x', email: 'nope' }))).toBe(
      'INVALID_EMAIL',
    )
  })

  it('caps the name length', () => {
    expect(codeOf(() => validateCrew({ phone: '4045551212', name: 'x'.repeat(121) }))).toBe(
      'LABOR_FIELD_TOO_LONG',
    )
  })
})

describe('normalizeNickname', () => {
  it('trims, and clears on blank', () => {
    expect(normalizeNickname(' Juan ')).toBe('Juan')
    expect(normalizeNickname('  ')).toBeNull()
    expect(normalizeNickname(null)).toBeNull()
    expect(codeOf(() => normalizeNickname('x'.repeat(121)))).toBe('LABOR_FIELD_TOO_LONG')
  })
})

describe('validatePacker', () => {
  it('accepts first + last + phone only, with no identity key', () => {
    expect(
      validatePacker({ firstName: 'Ana', lastName: 'Diaz', phone: '4045551212' }, TODAY),
    ).toEqual({
      firstName: 'Ana',
      lastName: 'Diaz',
      email: null,
      cidNumber: null,
      cidIssuedOn: null,
      phone: '+14045551212',
      cidKey: null,
      emailKey: null,
    })
  })

  it('derives the cid and email identity keys from the last name', () => {
    const p = validatePacker(
      {
        firstName: 'Ana',
        lastName: 'Díaz ',
        email: 'Ana@X.com',
        cidNumber: ' ab123 ',
        cidIssuedOn: '2024-01-31',
      },
      TODAY,
    )
    expect(p.cidNumber).toBe('AB123')
    expect(p.cidKey).toBe('diaz|AB123')
    expect(p.emailKey).toBe('diaz|ana@x.com')
  })

  it('requires first and last name', () => {
    expect(
      codeOf(() => validatePacker({ firstName: '', lastName: 'D', phone: '4045551212' }, TODAY)),
    ).toBe('LABOR_FIELD_REQUIRED')
    expect(
      codeOf(() => validatePacker({ firstName: 'A', lastName: ' ', phone: '4045551212' }, TODAY)),
    ).toBe('LABOR_FIELD_REQUIRED')
  })

  it('requires one of email, cid or phone', () => {
    expect(codeOf(() => validatePacker({ firstName: 'A', lastName: 'D' }, TODAY))).toBe(
      'PACKER_CONTACT_REQUIRED',
    )
  })

  it('requires a CID issue date with a CID number', () => {
    expect(
      codeOf(() => validatePacker({ firstName: 'A', lastName: 'D', cidNumber: '1' }, TODAY)),
    ).toBe('PACKER_CID_DATE_REQUIRED')
  })

  it('rejects an impossible or future CID date', () => {
    const base = { firstName: 'A', lastName: 'D', cidNumber: '1' }
    expect(codeOf(() => validatePacker({ ...base, cidIssuedOn: '2024-02-30' }, TODAY))).toBe(
      'PACKER_CID_DATE_INVALID',
    )
    expect(codeOf(() => validatePacker({ ...base, cidIssuedOn: '01/02/2024' }, TODAY))).toBe(
      'PACKER_CID_DATE_INVALID',
    )
    expect(codeOf(() => validatePacker({ ...base, cidIssuedOn: '2026-10-21' }, TODAY))).toBe(
      'PACKER_CID_DATE_INVALID',
    )
    expect(validatePacker({ ...base, cidIssuedOn: TODAY }, TODAY).cidIssuedOn).toBe(TODAY)
  })

  it('drops a CID date given without a CID number', () => {
    expect(
      validatePacker(
        { firstName: 'A', lastName: 'D', phone: '4045551212', cidIssuedOn: '2024-01-01' },
        TODAY,
      ).cidIssuedOn,
    ).toBeNull()
  })

  it('validates email and phone formats', () => {
    expect(
      codeOf(() => validatePacker({ firstName: 'A', lastName: 'D', email: 'x@' }, TODAY)),
    ).toBe('INVALID_EMAIL')
    expect(
      codeOf(() => validatePacker({ firstName: 'A', lastName: 'D', phone: '12' }, TODAY)),
    ).toBe('INVALID_PHONE_NUMBER')
  })

  it('caps the CID number', () => {
    expect(
      codeOf(() =>
        validatePacker(
          { firstName: 'A', lastName: 'D', cidNumber: 'X'.repeat(41), cidIssuedOn: TODAY },
          TODAY,
        ),
      ),
    ).toBe('LABOR_FIELD_TOO_LONG')
  })
})

describe('ratings', () => {
  it('accepts 1–5 whole stars and trims the comment', () => {
    expect(validateRating({ stars: 4, comment: ' good ' })).toEqual({ stars: 4, comment: 'good' })
    expect(validateRating({ stars: 1, comment: ' ' })).toEqual({ stars: 1, comment: null })
  })

  it.each([0, 6, 3.5, Number.NaN])('rejects %s stars', (stars) => {
    expect(codeOf(() => validateRating({ stars }))).toBe('INVALID_RATING')
  })

  it('caps the comment', () => {
    expect(codeOf(() => validateRating({ stars: 3, comment: 'x'.repeat(1001) }))).toBe(
      'LABOR_FIELD_TOO_LONG',
    )
  })

  it('shows the average only from three raters', () => {
    expect(aggregateRating([])).toBeNull()
    expect(aggregateRating([5, 1])).toBeNull()
    expect(aggregateRating([5, 4, 4])).toEqual({ average: 4.3, count: 3 })
    expect(aggregateRating([5], 1)).toEqual({ average: 5, count: 1 })
  })
})

describe('service areas', () => {
  it('knows US states and Canadian provinces', () => {
    expect(countryOfRegion('ga')).toBe('US')
    expect(countryOfRegion('ON')).toBe('CA')
    expect(countryOfRegion('ZZ')).toBeUndefined()
  })

  it('normalises and de-duplicates', () => {
    expect(
      validateServiceAreas([
        { city: ' Atlanta ', region: 'ga' },
        { city: 'atlanta', region: 'GA' },
        { city: 'Montréal', region: 'QC' },
      ]),
    ).toEqual([
      { city: 'Atlanta', region: 'GA', country: 'US', cityKey: 'atlanta' },
      { city: 'Montréal', region: 'QC', country: 'CA', cityKey: 'montreal' },
    ])
  })

  it('rejects an unknown region or a blank city', () => {
    expect(codeOf(() => validateServiceAreas([{ city: 'X', region: 'ZZ' }]))).toBe('INVALID_REGION')
    expect(codeOf(() => validateServiceAreas([{ city: '', region: 'GA' }]))).toBe(
      'LABOR_FIELD_REQUIRED',
    )
  })

  it('caps the list', () => {
    const many = Array.from({ length: MAX_SERVICE_AREAS + 1 }, (_, i) => ({
      city: `C${i}`,
      region: 'GA',
    }))
    expect(codeOf(() => validateServiceAreas(many))).toBe('TOO_MANY_SERVICE_AREAS')
  })
})

describe('parseLocationQuery', () => {
  it.each([
    ['', { kind: 'none' }],
    ['30301', { kind: 'postal', country: 'US', code: '30301' }],
    ['30301-1234', { kind: 'postal', country: 'US', code: '30301' }],
    ['m5v', { kind: 'postal', country: 'CA', code: 'M5V' }],
    ['M5V 2T6', { kind: 'postal', country: 'CA', code: 'M5V' }],
    ['m5v2t6', { kind: 'postal', country: 'CA', code: 'M5V' }],
    ['ga', { kind: 'region', country: 'US', region: 'GA' }],
    ['ON', { kind: 'region', country: 'CA', region: 'ON' }],
    ['Atlanta, ga', { kind: 'city', cityKey: 'atlanta', region: 'GA' }],
    ['St. Louis,MO', { kind: 'city', cityKey: 'st louis', region: 'MO' }],
    ['Atlanta', { kind: 'text', text: 'Atlanta' }],
    ['Juan, ZZ', { kind: 'text', text: 'Juan, ZZ' }],
    ['ZZ', { kind: 'text', text: 'ZZ' }],
  ])('reads %j', (raw, expected) => {
    expect(parseLocationQuery(raw)).toEqual(expected)
  })
})

describe('rankCrewsByDistance', () => {
  const atlanta = { lat: 33.749, lon: -84.388 }
  const crews = [
    { name: 'Nowhere', serviceAreas: [] },
    { name: 'Macon', serviceAreas: [{ lat: 32.84, lon: -83.632 }] },
    {
      name: 'Multi',
      serviceAreas: [
        { lat: 40.7128, lon: -74.006 }, // New York
        { lat: 33.95, lon: -84.55 }, // Marietta
        { lat: 25.76, lon: -80.19 }, // Miami — farther than Marietta, ignored
      ],
    },
    { name: 'Ungeocoded', serviceAreas: [{ lat: null, lon: null }] },
    { name: 'Atlanta', serviceAreas: [{ lat: 33.749, lon: -84.388 }] },
  ]

  it('orders nearest first on each crew’s closest area, ungeocoded last by name', () => {
    const ranked = rankCrewsByDistance(crews, atlanta)
    expect(ranked.map((c) => c.name)).toEqual([
      'Atlanta',
      'Multi',
      'Macon',
      'Nowhere',
      'Ungeocoded',
    ])
    expect(ranked[0]!.distanceMiles).toBe(0)
    expect(ranked[1]!.distanceMiles).toBeGreaterThan(10)
    expect(ranked[1]!.distanceMiles).toBeLessThan(25)
    expect(ranked[3]!.distanceMiles).toBeNull()
  })
})

describe('export', () => {
  const crew: ExportCrew = {
    phone: '+14045551212',
    name: 'Juan, Pedro; and Co',
    nickname: 'Juan',
    email: 'juan@x.com',
    serviceAreas: [
      { city: 'Atlanta', region: 'GA' },
      { city: 'Macon', region: 'GA' },
    ],
    myStars: 4,
    myComment: 'Fast\nand careful',
    packers: [
      {
        firstName: 'Ana',
        lastName: 'Díaz',
        email: null,
        phone: '+14045550000',
        cidNumber: 'AB1',
        cidIssuedOn: '2024-01-01',
      },
      {
        firstName: 'No',
        lastName: 'Phone',
        email: 'n@p.com',
        phone: null,
        cidNumber: null,
        cidIssuedOn: null,
      },
    ],
  }

  it('writes one vCard per crew plus one per packer with a phone', () => {
    const vcf = crewsToVCard([crew])
    expect(vcf.match(/BEGIN:VCARD/g)).toHaveLength(2)
    expect(vcf).toContain('FN:Juan\r\n')
    expect(vcf).toContain('TEL;TYPE=CELL:+14045551212')
    expect(vcf).toContain('N:Díaz;Ana;;;')
    expect(vcf).toContain('ORG:Juan\\, Pedro\\; and Co')
    expect(vcf.endsWith('END:VCARD\r\n')).toBe(true)
  })

  it('escapes and folds long lines to 75 octets', () => {
    const vcf = crewsToVCard([crew])
    const unfolded = vcf.replace(/\r\n /g, '')
    expect(unfolded).toContain('My comment: Fast\\nand careful')
    for (const line of vcf.split('\r\n')) {
      const octets = encodeURIComponent(line).replace(/%[0-9A-F]{2}/g, '.').length
      expect(octets).toBeLessThanOrEqual(75)
    }
  })

  it('writes an empty file for an empty list', () => {
    expect(crewsToVCard([])).toBe('')
  })

  const bare: ExportCrew = {
    phone: '+14045559999',
    name: 'Bare',
    nickname: null,
    email: null,
    serviceAreas: [],
    myStars: null,
    myComment: null,
    packers: [
      {
        firstName: 'Zoë',
        lastName: '日本🚚',
        email: 'z@x.com',
        phone: '+14045558888',
        cidNumber: 'C9',
        cidIssuedOn: null,
      },
    ],
  }

  it('omits empty fields and notes for a bare crew', () => {
    const vcf = crewsToVCard([bare])
    const [crewCard] = vcf.split('END:VCARD')
    expect(crewCard).toContain('FN:Bare\r\n')
    expect(crewCard).not.toContain('EMAIL')
    // Only the packer list — no crew-name, service-area or rating lines.
    expect(crewCard).toContain('NOTE:Packers: Zoë 日本🚚\r\n')
    expect(vcf).toContain('N:日本🚚;Zoë;;;')
    expect(vcf).toContain('CID: C9 (issued unknown)')
    expect(vcf).toContain('EMAIL;TYPE=INTERNET:z@x.com')
  })

  it('writes no NOTE for a crew with nothing to say, and no CID line without a CID', () => {
    const empty: ExportCrew = {
      ...bare,
      packers: [{ ...bare.packers[0]!, cidNumber: null }],
    }
    const [crewCard, packerCard] = crewsToVCard([{ ...empty, packers: [] }, empty]).split(
      'END:VCARD',
    )
    expect(crewCard).not.toContain('NOTE')
    expect(packerCard).not.toContain('CID')
  })

  it('folds on code-point boundaries for multi-byte text', () => {
    const wide: ExportCrew = { ...bare, myComment: '日本🚚Zoë'.repeat(12) }
    const vcf = crewsToVCard([wide])
    for (const line of vcf.split('\r\n')) {
      const octets = encodeURIComponent(line).replace(/%[0-9A-F]{2}/g, '.').length
      expect(octets).toBeLessThanOrEqual(75)
    }
    expect(vcf.replace(/\r\n /g, '')).toContain('日本🚚Zoë'.repeat(12))
  })

  it('writes the bare crew and an emailed packer to CSV', () => {
    const lines = crewsToGoogleContactsCsv([bare]).split('\r\n')
    expect(lines[1]).toBe('Bare,,Labor crew,Mobile,+14045559999,,,Packers: Zoë 日本🚚,Labor crews')
    expect(lines[2]).toMatch(/^Zoë,日本🚚,Bare,Mobile,\+14045558888,Work,z@x.com,/)
  })

  it('writes a Google Contacts CSV with quoting', () => {
    const csv = crewsToGoogleContactsCsv([crew])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(GOOGLE_CONTACTS_CSV_HEADERS.join(','))
    expect(lines[1]).toMatch(
      /^Juan,,Labor crew,Mobile,\+14045551212,Work,juan@x.com,"Crew: Juan, Pedro; and Co/,
    )
    expect(csv).toContain('Ana,Díaz,"Juan, Pedro; and Co",Mobile,+14045550000')
    expect(csv).not.toContain('No,Phone')
  })
})
