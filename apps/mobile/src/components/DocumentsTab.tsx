import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from 'react-native'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../theme/colors'
import { documentTypeLabel } from '../constants/documentTypes'
import { DocumentService, type DocumentSummary } from '../services/documentService'
import { formatLonghaulDate } from '../utils/longhaul-format'
import { logger } from '../utils/logger'
import { AddDocumentModal } from './AddDocumentModal'

interface Props {
  orderNum: string | number
}

export function DocumentsTab({ orderNum }: Props) {
  const [docs, setDocs] = useState<DocumentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addVisible, setAddVisible] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setDocs(await DocumentService.listForShipment(orderNum))
    } catch (err) {
      logger.warn('Failed to load documents', err)
      setError('Could not load documents. Pull to refresh.')
    } finally {
      setLoading(false)
    }
  }, [orderNum])

  useEffect(() => {
    void load()
  }, [load])

  const openDoc = async (doc: DocumentSummary) => {
    setOpening(doc.id)
    try {
      const url = await DocumentService.getDownloadUrl(doc.id, 'original')
      await Linking.openURL(url)
    } catch (err) {
      logger.warn('Failed to open document', err)
      setError('Could not open that document.')
    } finally {
      setOpening(null)
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.centeredText}>Loading documents…</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => setAddVisible(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Add a document"
      >
        <Text style={styles.addButtonText}>+ Add new</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {docs.length === 0 && !error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No documents yet</Text>
          <Text style={styles.emptySubtext}>
            Scan or choose paperwork for this shipment with “Add new”.
          </Text>
        </View>
      ) : (
        docs.map((doc) => (
          <TouchableOpacity
            key={doc.id}
            style={styles.row}
            onPress={() => void openDoc(doc)}
            disabled={opening === doc.id}
            activeOpacity={0.7}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowType}>{documentTypeLabel(doc.documentType)}</Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {doc.filename} · {formatLonghaulDate(doc.createdAt)}
              </Text>
            </View>
            {opening === doc.id ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.chevron}>›</Text>
            )}
          </TouchableOpacity>
        ))
      )}

      <AddDocumentModal
        visible={addVisible}
        orderNum={orderNum}
        onClose={() => setAddVisible(false)}
        onUploaded={() => {
          setAddVisible(false)
          setLoading(true)
          void load()
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  addButton: {
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.medium,
    backgroundColor: colors.primary,
    marginBottom: spacing.sm,
  },
  addButtonText: { color: colors.textLight, fontSize: fontSize.medium, fontWeight: '700' },
  error: { color: colors.error, fontSize: fontSize.medium, marginBottom: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: {
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptySubtext: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rowMain: { flex: 1 },
  rowType: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { fontSize: fontSize.small, color: colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: fontSize.xlarge, color: colors.textSecondary, marginLeft: spacing.sm },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl },
  centeredText: { marginTop: spacing.md, fontSize: fontSize.medium, color: colors.textSecondary },
})
