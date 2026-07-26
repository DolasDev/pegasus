import React, { useState } from 'react'
import {
  Modal,
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../theme/colors'
import {
  DOCUMENT_TYPES,
  DEFAULT_DOCUMENT_TYPE,
  documentTypeLabel,
} from '../constants/documentTypes'
import {
  scanPages,
  pickFromDevice,
  buildPdfFromImages,
  preparePickedPdf,
  PDF_MIME,
  type PreparedDocument,
} from '../services/documentCapture'
import { DocumentService } from '../services/documentService'
import { logger } from '../utils/logger'

interface Props {
  visible: boolean
  orderNum: string | number
  onClose: () => void
  onUploaded: () => void
}

// Local "draft" being assembled before upload: either image pages (from the
// scanner or picked images) or a single already-PDF file picked from the device.
type Draft =
  | { kind: 'images'; pages: string[] }
  | { kind: 'pdf'; fileUri: string; filename: string; sizeBytes: number }
  | null

export function AddDocumentModal({ visible, orderNum, onClose, onUploaded }: Props) {
  const [draft, setDraft] = useState<Draft>(null)
  const [docType, setDocType] = useState<string>(DEFAULT_DOCUMENT_TYPE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setDraft(null)
    setDocType(DEFAULT_DOCUMENT_TYPE)
    setBusy(false)
    setError(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const handleScan = async () => {
    setError(null)
    try {
      const pages = await scanPages()
      if (pages.length === 0) return // cancelled
      setDraft((prev) =>
        prev?.kind === 'images'
          ? { kind: 'images', pages: [...prev.pages, ...pages] }
          : { kind: 'images', pages },
      )
    } catch (err) {
      logger.error('Scan failed', err)
      setError('Scanning failed. Please try again.')
    }
  }

  const handlePick = async () => {
    setError(null)
    try {
      const picked = await pickFromDevice()
      if (!picked) return
      if (picked.kind === 'pdf') {
        setDraft({
          kind: 'pdf',
          fileUri: picked.fileUri,
          filename: picked.filename,
          sizeBytes: picked.sizeBytes,
        })
      } else {
        setDraft((prev) =>
          prev?.kind === 'images'
            ? { kind: 'images', pages: [...prev.pages, ...picked.imageUris] }
            : { kind: 'images', pages: picked.imageUris },
        )
      }
    } catch (err) {
      logger.error('File pick failed', err)
      setError('Could not read that file. Please try another.')
    }
  }

  const removePage = (index: number) => {
    setDraft((prev) => {
      if (prev?.kind !== 'images') return prev
      const pages = prev.pages.filter((_, i) => i !== index)
      return pages.length ? { kind: 'images', pages } : null
    })
  }

  const handleUpload = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      let prepared: PreparedDocument
      let filename: string
      if (draft.kind === 'pdf') {
        prepared = await preparePickedPdf({ fileUri: draft.fileUri, sizeBytes: draft.sizeBytes })
        filename = draft.filename
      } else {
        prepared = await buildPdfFromImages(draft.pages)
        filename = `${docType}-${orderNum}.pdf`
      }
      await DocumentService.uploadDocument({
        orderNum,
        documentType: docType,
        fileUri: prepared.fileUri,
        filename,
        mimeType: prepared.mimeType ?? PDF_MIME,
        sizeBytes: prepared.sizeBytes,
      })
      reset()
      onUploaded()
    } catch (err) {
      logger.error('Document upload failed', err)
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
      setBusy(false)
    }
  }

  const confirmClose = () => {
    if (draft && !busy) {
      Alert.alert('Discard document?', 'Your captured pages will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: close },
      ])
      return
    }
    if (!busy) close()
  }

  const pageCount = draft?.kind === 'images' ? draft.pages.length : draft?.kind === 'pdf' ? 1 : 0
  const canUpload = pageCount > 0 && !busy

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={confirmClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={confirmClose} disabled={busy} hitSlop={12}>
            <Text style={[styles.headerAction, busy && styles.disabled]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add document</Text>
          <TouchableOpacity onPress={handleUpload} disabled={!canUpload} hitSlop={12}>
            <Text style={[styles.headerAction, styles.save, !canUpload && styles.disabled]}>
              Save
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {/* Source actions */}
          <View style={styles.sourceRow}>
            <SourceButton label="Scan" icon="📷" onPress={handleScan} disabled={busy} />
            <SourceButton label="Choose file" icon="📄" onPress={handlePick} disabled={busy} />
          </View>

          {/* Draft preview */}
          {draft?.kind === 'images' && (
            <>
              <Text style={styles.sectionTitle}>
                {draft.pages.length} page{draft.pages.length === 1 ? '' : 's'}
              </Text>
              <View style={styles.thumbGrid}>
                {draft.pages.map((uri, i) => (
                  <View key={`${uri}-${i}`} style={styles.thumbWrap}>
                    <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.removeBadge}
                      onPress={() => removePage(i)}
                      disabled={busy}
                      hitSlop={8}
                      accessibilityLabel={`Remove page ${i + 1}`}
                    >
                      <Text style={styles.removeBadgeText}>✕</Text>
                    </TouchableOpacity>
                    <Text style={styles.pageNum}>{i + 1}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
          {draft?.kind === 'pdf' && (
            <View style={styles.pdfCard}>
              <Text style={styles.pdfIcon}>📄</Text>
              <Text style={styles.pdfName} numberOfLines={2}>
                {draft.filename}
              </Text>
            </View>
          )}

          {/* Document type */}
          {pageCount > 0 && (
            <>
              <Text style={styles.sectionTitle}>Document type</Text>
              <View style={styles.typeWrap}>
                {DOCUMENT_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    style={[styles.typeChip, docType === t.value && styles.typeChipActive]}
                    onPress={() => setDocType(t.value)}
                    disabled={busy}
                  >
                    <Text style={[styles.typeText, docType === t.value && styles.typeTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {busy && (
          <View style={styles.busyOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.busyText}>Uploading {documentTypeLabel(docType)}…</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  )
}

function SourceButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string
  icon: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.sourceBtn, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text style={styles.sourceIcon}>{icon}</Text>
      <Text style={styles.sourceLabel}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headerTitle: { fontSize: fontSize.large, fontWeight: '700', color: colors.textPrimary },
  headerAction: { fontSize: fontSize.medium, color: colors.textSecondary },
  save: { color: colors.primary, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  body: { padding: spacing.md, gap: spacing.md },
  sourceRow: { flexDirection: 'row', gap: spacing.md },
  sourceBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    minHeight: touchTarget.minHeight,
  },
  sourceIcon: { fontSize: 28, marginBottom: spacing.xs },
  sourceLabel: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  sectionTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbWrap: { width: 92, height: 120 },
  thumb: {
    width: 92,
    height: 120,
    borderRadius: borderRadius.small,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  removeBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBadgeText: { color: colors.textLight, fontSize: 12, fontWeight: '700' },
  pageNum: {
    position: 'absolute',
    bottom: 2,
    left: 4,
    color: colors.textLight,
    fontSize: fontSize.small,
    fontWeight: '700',
    textShadowColor: '#000',
    textShadowRadius: 3,
  },
  pdfCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  pdfIcon: { fontSize: 28 },
  pdfName: { flex: 1, fontSize: fontSize.medium, color: colors.textPrimary },
  typeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { fontSize: fontSize.medium, fontWeight: '600', color: colors.textPrimary },
  typeTextActive: { color: colors.textLight },
  error: { color: colors.error, fontSize: fontSize.medium },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  busyText: { color: colors.textLight, fontSize: fontSize.large, fontWeight: '600' },
})
