import { DocumentService } from './documentService'

const mockFetch = jest.fn()
const mockFetchPaginated = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({ fetch: mockFetch, fetchPaginated: mockFetchPaginated })),
}))

jest.mock('../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

const mockUploadAsync = jest.fn()
jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  FileSystemUploadType: { BINARY_CONTENT: 'binary' },
}))

describe('DocumentService', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('listForShipment', () => {
    it('lists via the shipment entity endpoint and returns data', async () => {
      mockFetchPaginated.mockResolvedValueOnce({ data: [{ id: 'd1' }], meta: { count: 1 } })
      const res = await DocumentService.listForShipment('12345')
      expect(mockFetchPaginated).toHaveBeenCalledWith('/api/v1/documents/entity/shipment/12345')
      expect(res).toEqual([{ id: 'd1' }])
    })

    it('url-encodes the order number', async () => {
      mockFetchPaginated.mockResolvedValueOnce({ data: [], meta: { count: 0 } })
      await DocumentService.listForShipment('a/b')
      expect(mockFetchPaginated).toHaveBeenCalledWith('/api/v1/documents/entity/shipment/a%2Fb')
    })
  })

  describe('getDownloadUrl', () => {
    it('returns the presigned downloadUrl and passes the variant', async () => {
      mockFetch.mockResolvedValueOnce({ downloadUrl: 'https://s3/get', variant: 'thumb' })
      const url = await DocumentService.getDownloadUrl('doc-1', 'thumb')
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/documents/doc-1/download-url?variant=thumb')
      expect(url).toBe('https://s3/get')
    })
  })

  describe('uploadDocument', () => {
    const params = {
      orderNum: '999',
      documentType: 'bol',
      fileUri: 'file:///tmp/doc.pdf',
      filename: 'bol-999.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    }

    it('runs reserve → S3 PUT → finalize in order', async () => {
      mockFetch
        .mockResolvedValueOnce({
          documentId: 'doc-9',
          uploadUrl: 'https://s3/put',
          expiresInSeconds: 900,
        })
        .mockResolvedValueOnce({ id: 'doc-9', status: 'ACTIVE' })
      mockUploadAsync.mockResolvedValueOnce({ status: 200, body: '' })

      const result = await DocumentService.uploadDocument(params)

      // 1. reserve
      expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/v1/documents/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'shipment',
          entityId: '999',
          documentType: 'bol',
          filename: 'bol-999.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
        }),
      })
      // 2. PUT to the presigned URL with matching Content-Type
      expect(mockUploadAsync).toHaveBeenCalledWith('https://s3/put', 'file:///tmp/doc.pdf', {
        httpMethod: 'PUT',
        uploadType: 'binary',
        headers: { 'Content-Type': 'application/pdf' },
      })
      // 3. finalize
      expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/v1/documents/doc-9/finalize', {
        method: 'POST',
      })
      expect(result).toEqual({ id: 'doc-9', status: 'ACTIVE' })
    })

    it('throws and does not finalize when the S3 PUT fails', async () => {
      mockFetch.mockResolvedValueOnce({ documentId: 'doc-9', uploadUrl: 'https://s3/put' })
      mockUploadAsync.mockResolvedValueOnce({ status: 403, body: 'AccessDenied' })

      await expect(DocumentService.uploadDocument(params)).rejects.toThrow(/storage returned 403/)
      // only the reserve call happened; finalize never fired
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })
})
