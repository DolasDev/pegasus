import { scanPages, pickFromDevice, buildPdfFromImages, preparePickedPdf } from './documentCapture'

const mockScan = jest.fn()
jest.mock('react-native-document-scanner-plugin', () => ({
  __esModule: true,
  default: { scanDocument: (...a: unknown[]) => mockScan(...a) },
  ResponseType: { ImageFilePath: 'imageFilePath', Base64: 'base64' },
  ScanDocumentResponseStatus: { Success: 'success', Cancel: 'cancel' },
}))

const mockGetDocumentAsync = jest.fn()
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...a: unknown[]) => mockGetDocumentAsync(...a),
}))

const mockPrintToFileAsync = jest.fn()
jest.mock('expo-print', () => ({
  printToFileAsync: (...a: unknown[]) => mockPrintToFileAsync(...a),
}))

const mockReadAsStringAsync = jest.fn()
const mockGetInfoAsync = jest.fn()
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: (...a: unknown[]) => mockReadAsStringAsync(...a),
  getInfoAsync: (...a: unknown[]) => mockGetInfoAsync(...a),
  EncodingType: { Base64: 'base64' },
}))

describe('scanPages', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns scanned image URIs on success', async () => {
    mockScan.mockResolvedValueOnce({
      scannedImages: ['file://p1.jpg', 'file://p2.jpg'],
      status: 'success',
    })
    await expect(scanPages()).resolves.toEqual(['file://p1.jpg', 'file://p2.jpg'])
  })

  it('returns an empty array when the user cancels', async () => {
    mockScan.mockResolvedValueOnce({ status: 'cancel' })
    await expect(scanPages()).resolves.toEqual([])
  })
})

describe('pickFromDevice', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns null when cancelled', async () => {
    mockGetDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null })
    await expect(pickFromDevice()).resolves.toBeNull()
  })

  it('returns a pdf source when a PDF is picked', async () => {
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file://x.pdf', name: 'x.pdf', mimeType: 'application/pdf', size: 500 }],
    })
    await expect(pickFromDevice()).resolves.toEqual({
      kind: 'pdf',
      fileUri: 'file://x.pdf',
      filename: 'x.pdf',
      sizeBytes: 500,
    })
  })

  it('returns image page URIs when images are picked', async () => {
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        { uri: 'file://a.jpg', name: 'a.jpg', mimeType: 'image/jpeg' },
        { uri: 'file://b.jpg', name: 'b.jpg', mimeType: 'image/jpeg' },
      ],
    })
    await expect(pickFromDevice()).resolves.toEqual({
      kind: 'images',
      imageUris: ['file://a.jpg', 'file://b.jpg'],
    })
  })
})

describe('buildPdfFromImages', () => {
  beforeEach(() => jest.clearAllMocks())

  it('reads each page, prints one PDF, and reports size + page count', async () => {
    mockReadAsStringAsync.mockResolvedValue('BASE64DATA')
    mockPrintToFileAsync.mockResolvedValueOnce({ uri: 'file://out.pdf' })
    mockGetInfoAsync.mockResolvedValueOnce({ exists: true, isDirectory: false, size: 4096 })

    const result = await buildPdfFromImages(['file://p1.jpg', 'file://p2.jpg'])

    expect(mockReadAsStringAsync).toHaveBeenCalledTimes(2)
    const html = (mockPrintToFileAsync.mock.calls[0][0] as { html: string }).html
    expect(html.match(/data:image\/jpeg;base64,BASE64DATA/g)).toHaveLength(2)
    expect(result).toEqual({
      fileUri: 'file://out.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
      pageCount: 2,
    })
  })

  it('throws when there are no pages', async () => {
    await expect(buildPdfFromImages([])).rejects.toThrow(/No pages/)
  })
})

describe('preparePickedPdf', () => {
  beforeEach(() => jest.clearAllMocks())

  it('keeps the provided size without re-reading the file', async () => {
    const res = await preparePickedPdf({ fileUri: 'file://x.pdf', sizeBytes: 321 })
    expect(res).toEqual({
      fileUri: 'file://x.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 321,
      pageCount: 1,
    })
    expect(mockGetInfoAsync).not.toHaveBeenCalled()
  })

  it('falls back to getInfoAsync when size is missing', async () => {
    mockGetInfoAsync.mockResolvedValueOnce({ exists: true, isDirectory: false, size: 777 })
    const res = await preparePickedPdf({ fileUri: 'file://x.pdf', sizeBytes: 0 })
    expect(res.sizeBytes).toBe(777)
  })
})
