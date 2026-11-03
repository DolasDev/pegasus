import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { crewsToVCard, crewsToGoogleContactsCsv } from '@pegasus/domain'
import { LaborService } from './laborService'

// ---------------------------------------------------------------------------
// Export the driver's Labor list so they can take it with them.
//
//   vcf — vCard 3.0. iOS and Android Contacts both import it directly from
//         the share sheet; the recommended choice.
//   csv — Google Contacts CSV, for contacts.google.com → Import, or a
//         spreadsheet.
//
// Rendering is the domain's (crewsToVCard / crewsToGoogleContactsCsv); this
// only writes the file to the cache directory and opens the share sheet.
// ---------------------------------------------------------------------------

export type LaborExportFormat = 'vcf' | 'csv'

const FORMATS = {
  vcf: { file: 'labor-crews.vcf', mimeType: 'text/vcard', UTI: 'public.vcard' },
  csv: { file: 'labor-crews.csv', mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' },
} as const

export class LaborExportError extends Error {}

/** Returns how many crews were exported. */
export async function exportLaborList(format: LaborExportFormat): Promise<number> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new LaborExportError('Sharing isn’t available on this device')
  }
  const crews = await LaborService.getExport()
  if (!crews.length) throw new LaborExportError('Your Labor list is empty')

  const spec = FORMATS[format]
  const body = format === 'vcf' ? crewsToVCard(crews) : crewsToGoogleContactsCsv(crews)
  const uri = `${FileSystem.cacheDirectory ?? ''}${spec.file}`
  await FileSystem.writeAsStringAsync(uri, body, { encoding: FileSystem.EncodingType.UTF8 })
  await Sharing.shareAsync(uri, {
    mimeType: spec.mimeType,
    UTI: spec.UTI,
    dialogTitle: 'Export Labor list',
  })
  return crews.length
}
