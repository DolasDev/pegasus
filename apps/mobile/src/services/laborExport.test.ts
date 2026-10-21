import * as Sharing from 'expo-sharing'
import * as FileSystem from 'expo-file-system/legacy'
import { exportLaborList, LaborExportError } from './laborExport'
import { LaborService } from './laborService'

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  EncodingType: { UTF8: 'utf8' },
}))

jest.mock('./laborService', () => ({
  LaborService: { getExport: jest.fn() },
}))

const crew = {
  phone: '+14045550101',
  name: 'Ace Movers',
  nickname: null,
  email: null,
  serviceAreas: [{ city: 'Macon', region: 'GA' }],
  myStars: 5,
  myComment: null,
  packers: [],
}

describe('exportLaborList', () => {
  const getExport = LaborService.getExport as jest.Mock
  const write = FileSystem.writeAsStringAsync as jest.Mock

  it('writes a vCard and opens the share sheet', async () => {
    getExport.mockResolvedValueOnce([crew])
    expect(await exportLaborList('vcf')).toBe(1)
    const [uri, body] = write.mock.calls[0]
    expect(uri).toBe('file:///cache/labor-crews.vcf')
    expect(body).toContain('BEGIN:VCARD')
    expect(body).toContain('FN:Ace Movers')
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      'file:///cache/labor-crews.vcf',
      expect.objectContaining({ mimeType: 'text/vcard', UTI: 'public.vcard' }),
    )
  })

  it('writes a Google Contacts CSV', async () => {
    getExport.mockResolvedValueOnce([crew])
    await exportLaborList('csv')
    const [uri, body] = write.mock.calls[0]
    expect(uri).toBe('file:///cache/labor-crews.csv')
    expect(body.split('\r\n')[0]).toContain('Phone 1 - Value')
  })

  it('refuses an empty list and a device without sharing', async () => {
    getExport.mockResolvedValueOnce([])
    await expect(exportLaborList('vcf')).rejects.toThrow(LaborExportError)

    ;(Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false)
    await expect(exportLaborList('vcf')).rejects.toThrow('Sharing isn’t available')
    expect(write).not.toHaveBeenCalled()
  })
})
