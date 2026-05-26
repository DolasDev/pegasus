// ---------------------------------------------------------------------------
// Cloud-direct longhaul trip-note write handlers (Phase 4 #5).
//
// On-prem source: handlers/longhaul/trips.ts (POST /trips/:id/notes,
// PATCH /notes/:id) → createNote / patchNote (trips.repository.ts).
//   POST /trips/:id/notes  — INSERT into TripNotes; createdBy = resolved legacy
//                            user code (the proxy ignores body.createdBy and
//                            uses longhaulUser.code ?? 0).
//   PATCH /notes/:id       — UPDATE TripNotes SET note, updatedAt WHERE
//                            tripId + id.
//
// TripNotes columns are camelCase (tripId, createdBy, createdAt, updatedAt) and
// all NOT NULL. Single-row, single-statement writes.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { executeSql, MssqlExecError } from '../../lib/mssql-executor-client'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { logger } from '../../lib/logger'

const TripNoteBody = z.object({
  note: z.string().min(1),
  type: z.string().optional(),
})

const PatchNoteBody = z.object({
  note: z.string().min(1),
  tripId: z.number().optional(),
})

const INSERT_NOTE_SQL = `
INSERT INTO TripNotes (tripId, note, createdBy, type, createdAt, updatedAt)
VALUES (@tripId, @note, @createdBy, @type, GETDATE(), GETDATE())
`

const PATCH_NOTE_SQL = `
UPDATE TripNotes SET note = @note, updatedAt = GETDATE()
WHERE tripId = @tripId AND id = @id
`

export const longhaulCreateTripNoteHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const tripId = Number.parseInt(c.req.param('id') ?? '', 10)
  if (Number.isNaN(tripId)) {
    return c.json({ error: 'Invalid trip id', code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const parsed = TripNoteBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }

  const resolved = await resolveLonghaulUser({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    apiClient: c.get('apiClient'),
  })
  if (!resolved.ok) {
    return c.json({ error: resolved.error, code: resolved.code, correlationId }, resolved.status)
  }

  try {
    await executeSql(resolved.connectionString, INSERT_NOTE_SQL, {
      params: [
        { name: 'tripId', value: tripId },
        { name: 'note', value: parsed.data.note },
        // createdBy is NOT NULL; the proxy stamps longhaulUser.code ?? 0.
        { name: 'createdBy', value: resolved.code ?? 0 },
        { name: 'type', value: parsed.data.type ?? 'DISPATCH' },
      ],
    })
    return c.json({ data: { success: true } }, 201)
  } catch (err) {
    logger.error('longhaul cloud create trip note failed', { error: errDetail(err) })
    return c.json({ error: 'Failed to create note', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
}

export const longhaulPatchTripNoteHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const noteId = Number.parseInt(c.req.param('id') ?? '', 10)
  if (Number.isNaN(noteId)) {
    return c.json({ error: 'Invalid note id', code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const parsed = PatchNoteBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }

  const resolved = await resolveLonghaulUser({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    apiClient: c.get('apiClient'),
  })
  if (!resolved.ok) {
    return c.json({ error: resolved.error, code: resolved.code, correlationId }, resolved.status)
  }

  try {
    await executeSql(resolved.connectionString, PATCH_NOTE_SQL, {
      params: [
        { name: 'note', value: parsed.data.note },
        // The proxy scopes the update by tripId AND id (body.tripId ?? 0).
        { name: 'tripId', value: parsed.data.tripId ?? 0 },
        { name: 'id', value: noteId },
      ],
    })
    return c.json({ data: { success: true } })
  } catch (err) {
    logger.error('longhaul cloud patch trip note failed', { error: errDetail(err) })
    return c.json({ error: 'Failed to patch note', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
}

function errDetail(err: unknown): string {
  return err instanceof MssqlExecError ? err.message : String(err)
}
