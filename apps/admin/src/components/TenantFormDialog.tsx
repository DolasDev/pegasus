import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createTenant, updateTenant } from '@/api/tenants'
import type { TenantDetail, TenantPlan, CreateTenantBody, UpdateTenantBody } from '@/api/tenants'
import { ApiError } from '@/api/client'

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateCreate(fields: CreateFields): Partial<Record<keyof CreateFields, string>> {
  const errors: Partial<Record<keyof CreateFields, string>> = {}
  if (!fields.name.trim()) errors.name = 'Name is required.'
  if (!fields.slug.trim()) {
    errors.slug = 'Slug is required.'
  } else if (fields.slug.length < 3 || fields.slug.length > 63) {
    errors.slug = 'Slug must be 3–63 characters.'
  } else if (!SLUG_RE.test(fields.slug)) {
    errors.slug =
      'Slug must start with a letter, use only lowercase letters, numbers, or hyphens, and end with a letter or digit.'
  }
  if (fields.contactEmail && !EMAIL_RE.test(fields.contactEmail)) {
    errors.contactEmail = 'Must be a valid email address.'
  }
  return errors
}

function validateEdit(fields: EditFields): Partial<Record<keyof EditFields, string>> {
  const errors: Partial<Record<keyof EditFields, string>> = {}
  if (!fields.name.trim()) errors.name = 'Name is required.'
  if (fields.contactEmail && !EMAIL_RE.test(fields.contactEmail)) {
    errors.contactEmail = 'Must be a valid email address.'
  }
  if (fields.ssoConfig.trim()) {
    try {
      const parsed = JSON.parse(fields.ssoConfig) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        errors.ssoConfig = 'Must be a JSON object (e.g. {"key": "value"}).'
      }
    } catch {
      errors.ssoConfig = 'Invalid JSON.'
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// Field state shapes
// ---------------------------------------------------------------------------

interface CreateFields {
  name: string
  slug: string
  plan: TenantPlan | ''
  contactName: string
  contactEmail: string
}

interface EditFields {
  name: string
  plan: TenantPlan | ''
  contactName: string
  contactEmail: string
  ssoConfig: string
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type CreateProps = { mode: 'create'; tenant?: undefined; onClose: () => void }
type EditProps = { mode: 'edit'; tenant: TenantDetail; onClose: () => void }
export type TenantFormDialogProps = CreateProps | EditProps

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function TenantFormDialog(props: TenantFormDialogProps) {
  const { mode, onClose } = props
  const queryClient = useQueryClient()
  const backdropRef = useRef<HTMLDivElement>(null)

  // --- Create-mode state ---
  const [create, setCreate] = useState<CreateFields>({
    name: '',
    slug: '',
    plan: '',
    contactName: '',
    contactEmail: '',
  })

  // --- Edit-mode state (initialised from tenant prop) ---
  const [edit, setEdit] = useState<EditFields>(() => {
    if (mode === 'edit') {
      const t = props.tenant
      return {
        name: t.name,
        plan: t.plan,
        contactName: t.contactName ?? '',
        contactEmail: t.contactEmail ?? '',
        ssoConfig:
          t.ssoProviderConfig !== null ? JSON.stringify(t.ssoProviderConfig, null, 2) : '',
      }
    }
    return { name: '', plan: '', contactName: '', contactEmail: '', ssoConfig: '' }
  })

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [apiError, setApiError] = useState<string | null>(null)

  // Close on ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Mutations
  const createMutation = useMutation({
    mutationFn: (body: CreateTenantBody) => createTenant(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      onClose()
    },
    onError: (err) => {
      setApiError(err instanceof ApiError ? err.message : 'An unexpected error occurred.')
    },
  })

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTenantBody }) => updateTenant(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      onClose()
    },
    onError: (err) => {
      setApiError(err instanceof ApiError ? err.message : 'An unexpected error occurred.')
    },
  })

  const isPending = createMutation.isPending || editMutation.isPending

  // --- Submit ---
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setApiError(null)

    if (mode === 'create') {
      const errors = validateCreate(create)
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors)
        return
      }
      setFieldErrors({})
      const body: CreateTenantBody = {
        name: create.name.trim(),
        slug: create.slug.trim(),
        ...(create.plan ? { plan: create.plan } : {}),
        ...(create.contactName.trim() ? { contactName: create.contactName.trim() } : {}),
        ...(create.contactEmail.trim() ? { contactEmail: create.contactEmail.trim() } : {}),
      }
      createMutation.mutate(body)
    } else {
      const errors = validateEdit(edit)
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors)
        return
      }
      setFieldErrors({})

      let ssoProviderConfig: Record<string, unknown> | null | undefined = undefined
      if (edit.ssoConfig.trim()) {
        ssoProviderConfig = JSON.parse(edit.ssoConfig) as Record<string, unknown>
      } else if (props.tenant.ssoProviderConfig !== null) {
        // Field was cleared — send null to remove it.
        ssoProviderConfig = null
      }

      const body: UpdateTenantBody = {
        name: edit.name.trim(),
        ...(edit.plan ? { plan: edit.plan } : {}),
        contactName: edit.contactName.trim() || null,
        contactEmail: edit.contactEmail.trim() || null,
        ...(ssoProviderConfig !== undefined ? { ssoProviderConfig } : {}),
      }
      editMutation.mutate({ id: props.tenant.id, body })
    }
  }

  // --- Auto-slug from name (create only, until user edits slug manually) ---
  const slugEditedRef = useRef(false)
  function handleNameChange(val: string) {
    setCreate((prev) => {
      const next = { ...prev, name: val }
      if (!slugEditedRef.current) {
        next.slug = val
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 63)
      }
      return next
    })
  }

  // --- Render ---
  const title = mode === 'create' ? 'Create tenant' : 'Edit tenant'

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4 px-6 py-4">
            {/* API-level error */}
            {apiError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {apiError}
              </div>
            )}

            <Field label="Name *" error={fieldErrors['name']}>
              {mode === 'create' ? (
                <input
                  className={inputCls}
                  value={create.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Acme Moving Co."
                  disabled={isPending}
                  maxLength={255}
                />
              ) : (
                <input
                  className={inputCls}
                  value={edit.name}
                  onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Acme Moving Co."
                  disabled={isPending}
                  maxLength={255}
                />
              )}
            </Field>

            {mode === 'create' ? (
              <Field
                label="Slug *"
                error={fieldErrors['slug']}
              >
                <input
                  className={inputCls + ' font-mono'}
                  value={create.slug}
                  onChange={(e) => {
                    slugEditedRef.current = true
                    setCreate((p) => ({ ...p, slug: e.target.value }))
                  }}
                  placeholder="acme-moving"
                  disabled={isPending}
                  maxLength={63}
                />
                <p className="text-xs text-muted-foreground">
                  Subdomain identifier — lowercase letters, numbers, hyphens. Cannot be changed
                  after creation.
                </p>
              </Field>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Slug</p>
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-muted-foreground">
                  {props.tenant.slug}
                </p>
                <p className="text-xs text-muted-foreground">Slug is immutable after creation.</p>
              </div>
            )}

            <Field label="Plan">
              {mode === 'create' ? (
                <select
                  className={inputCls}
                  value={create.plan}
                  onChange={(e) =>
                    setCreate((p) => ({ ...p, plan: e.target.value as TenantPlan | '' }))
                  }
                  disabled={isPending}
                >
                  <option value="">Default (Starter)</option>
                  <option value="STARTER">Starter</option>
                  <option value="GROWTH">Growth</option>
                  <option value="ENTERPRISE">Enterprise</option>
                </select>
              ) : (
                <select
                  className={inputCls}
                  value={edit.plan}
                  onChange={(e) =>
                    setEdit((p) => ({ ...p, plan: e.target.value as TenantPlan | '' }))
                  }
                  disabled={isPending}
                >
                  <option value="STARTER">Starter</option>
                  <option value="GROWTH">Growth</option>
                  <option value="ENTERPRISE">Enterprise</option>
                </select>
              )}
            </Field>

            <Field label="Contact name" error={fieldErrors['contactName']}>
              {mode === 'create' ? (
                <input
                  className={inputCls}
                  value={create.contactName}
                  onChange={(e) => setCreate((p) => ({ ...p, contactName: e.target.value }))}
                  placeholder="Jane Smith"
                  disabled={isPending}
                  maxLength={255}
                />
              ) : (
                <input
                  className={inputCls}
                  value={edit.contactName}
                  onChange={(e) => setEdit((p) => ({ ...p, contactName: e.target.value }))}
                  placeholder="Jane Smith (clear to remove)"
                  disabled={isPending}
                  maxLength={255}
                />
              )}
            </Field>

            <Field label="Contact email" error={fieldErrors['contactEmail']}>
              {mode === 'create' ? (
                <input
                  type="email"
                  className={inputCls}
                  value={create.contactEmail}
                  onChange={(e) => setCreate((p) => ({ ...p, contactEmail: e.target.value }))}
                  placeholder="jane@acme.com"
                  disabled={isPending}
                />
              ) : (
                <input
                  type="email"
                  className={inputCls}
                  value={edit.contactEmail}
                  onChange={(e) => setEdit((p) => ({ ...p, contactEmail: e.target.value }))}
                  placeholder="jane@acme.com (clear to remove)"
                  disabled={isPending}
                />
              )}
            </Field>

            {mode === 'edit' && (
              <Field
                label="SSO provider config (JSON)"
                error={fieldErrors['ssoConfig']}
              >
                <textarea
                  className={inputCls + ' font-mono text-xs h-24 resize-y'}
                  value={edit.ssoConfig}
                  onChange={(e) => setEdit((p) => ({ ...p, ssoConfig: e.target.value }))}
                  placeholder={'{\n  "provider": "okta",\n  "clientId": "…"\n}'}
                  disabled={isPending}
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Optional JSON object. Clear the field to remove the configuration.
                </p>
              </Field>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? 'Saving…' : mode === 'create' ? 'Create tenant' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
