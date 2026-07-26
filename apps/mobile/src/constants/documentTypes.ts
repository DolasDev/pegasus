// ---------------------------------------------------------------------------
// Document types a driver can classify a scanned/uploaded shipment document as.
//
// `documentType` is a free-form string on the backend (apps/api documents
// handler); this is the curated list the mobile app offers so values stay
// consistent with what dispatchers expect to see.
// ---------------------------------------------------------------------------

export interface DocumentTypeOption {
  value: string
  label: string
}

export const DOCUMENT_TYPES: DocumentTypeOption[] = [
  { value: 'bol', label: 'Bill of Lading' },
  { value: 'pod', label: 'Proof of Delivery' },
  { value: 'weight_ticket', label: 'Weight Ticket' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' },
]

export const DEFAULT_DOCUMENT_TYPE = DOCUMENT_TYPES[0]!.value

/** Human label for a stored `documentType` value (falls back to the raw value). */
export function documentTypeLabel(value: string): string {
  return DOCUMENT_TYPES.find((t) => t.value === value)?.label ?? value
}
