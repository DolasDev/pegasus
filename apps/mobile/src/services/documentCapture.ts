import DocumentScanner, {
  ResponseType,
  ScanDocumentResponseStatus,
} from 'react-native-document-scanner-plugin'
import * as DocumentPicker from 'expo-document-picker'
import * as Print from 'expo-print'
import * as FileSystem from 'expo-file-system/legacy'

// ---------------------------------------------------------------------------
// Document capture — the "Google Drive scan" side of the flow. Pages can come
// from the native document scanner (edge-detected, multi-page) or from an
// existing file on the device. Image pages are assembled into one multi-page
// PDF before upload; a picked PDF is used as-is.
// ---------------------------------------------------------------------------

export const PDF_MIME = 'application/pdf'

/** A file ready to hand to DocumentService.uploadDocument. */
export interface PreparedDocument {
  fileUri: string
  mimeType: string
  sizeBytes: number
  /** Number of source pages (1 for a picked PDF). */
  pageCount: number
}

/** Result of the device file picker: either a ready PDF or image pages. */
export type PickedSource =
  | { kind: 'pdf'; fileUri: string; filename: string; sizeBytes: number }
  | { kind: 'images'; imageUris: string[] }

/**
 * Open the native scanner and return the scanned page image URIs. An empty
 * array means the user cancelled.
 */
export async function scanPages(): Promise<string[]> {
  const { scannedImages, status } = await DocumentScanner.scanDocument({
    responseType: ResponseType.ImageFilePath,
  })
  if (status === ScanDocumentResponseStatus.Cancel) return []
  return scannedImages ?? []
}

/**
 * Let the user pick a PDF or image(s) from the device. Returns null when the
 * picker is cancelled or yields nothing.
 */
export async function pickFromDevice(): Promise<PickedSource | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: [PDF_MIME, 'image/*'],
    multiple: true,
    copyToCacheDirectory: true,
  })
  if (res.canceled || !res.assets?.length) return null

  const pdf = res.assets.find(
    (a) => a.mimeType === PDF_MIME || a.name?.toLowerCase().endsWith('.pdf'),
  )
  if (pdf) {
    return {
      kind: 'pdf',
      fileUri: pdf.uri,
      filename: pdf.name ?? 'document.pdf',
      sizeBytes: pdf.size ?? (await fileSize(pdf.uri)),
    }
  }
  return { kind: 'images', imageUris: res.assets.map((a) => a.uri) }
}

/** Assemble page image URIs into a single multi-page PDF. */
export async function buildPdfFromImages(imageUris: string[]): Promise<PreparedDocument> {
  if (imageUris.length === 0) throw new Error('No pages to save')
  const pages = await Promise.all(
    imageUris.map(async (uri) => {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      // One image per page; break after each so the PDF is one page per scan.
      return `<div style="page-break-after:always;"><img src="data:image/jpeg;base64,${b64}" style="width:100%;display:block;"/></div>`
    }),
  )
  const html = `<html><head><meta name="viewport" content="width=device-width"/></head><body style="margin:0;padding:0;">${pages.join(
    '',
  )}</body></html>`
  const { uri } = await Print.printToFileAsync({ html })
  return {
    fileUri: uri,
    mimeType: PDF_MIME,
    sizeBytes: await fileSize(uri),
    pageCount: imageUris.length,
  }
}

/** Wrap an already-PDF source as a PreparedDocument. */
export async function preparePickedPdf(source: {
  fileUri: string
  sizeBytes: number
}): Promise<PreparedDocument> {
  const sizeBytes = source.sizeBytes || (await fileSize(source.fileUri))
  return { fileUri: source.fileUri, mimeType: PDF_MIME, sizeBytes, pageCount: 1 }
}

async function fileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri)
  return info.exists && !info.isDirectory ? (info.size ?? 0) : 0
}
