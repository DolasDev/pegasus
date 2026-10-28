// ---------------------------------------------------------------------------
// Packer writes on a shared crew — one implementation for both writers:
//   - a signed-in driver on /api/v1/labor/crews/:phone/packers (handlers/labor.ts)
//   - a crew leader on the public crew link (handlers/crew-link-public.ts)
//
// The caller resolves access first; these only enforce what the row itself
// must satisfy (domain validation, the per-crew identity keys, the packer
// belonging to `crewPhone`). `userId` is who the write is attributed to.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { Prisma, type Packer, type PrismaClient } from '@prisma/client'
import { formatPhoneNumber, validatePacker } from '@pegasus/domain'

/** An HTTP-shaped failure the calling handler maps to its own error body. */
export class LaborHttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export const PackerBody = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullish(),
  cidNumber: z.string().nullish(),
  cidIssuedOn: z.string().nullish(),
  phone: z.string().nullish(),
})
export type PackerInput = z.infer<typeof PackerBody>

export const todayIso = () => new Date().toISOString().slice(0, 10)
export const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
export const toDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null)

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export function packerDto(p: Packer) {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    cidNumber: p.cidNumber,
    cidIssuedOn: dateOnly(p.cidIssuedOn),
    phone: p.phone,
    phoneDisplay: p.phone ? formatPhoneNumber(p.phone) : null,
    updatedAt: p.updatedAt.toISOString(),
  }
}

function packerDuplicate(): LaborHttpError {
  return new LaborHttpError(
    409,
    'PACKER_DUPLICATE',
    'This crew already has a packer with that last name and CID number or email',
  )
}

const packerNotFound = () => new LaborHttpError(404, 'PACKER_NOT_FOUND', 'Packer not found')

type Db = Pick<PrismaClient, 'packer'>

/** The identity keys a packer is matched on, as `where` fragments. */
function identityKeys(p: { cidKey: string | null; emailKey: string | null }) {
  return [
    ...(p.cidKey ? [{ cidKey: p.cidKey }] : []),
    ...(p.emailKey ? [{ emailKey: p.emailKey }] : []),
  ]
}

/**
 * A removed packer keeps its identity keys so adding the same person again
 * brings them back — until a live packer needs one of those keys. Then the
 * removed row gives it up (it can no longer be restored by that key), so the
 * unique index never reports a "duplicate" nobody can see. Same rule as My Crew.
 */
async function releaseRemovedKeys(
  db: Db,
  crewPhone: string,
  keys: ReturnType<typeof identityKeys>,
  exceptId: string | undefined,
): Promise<void> {
  const where = {
    crewPhone,
    removedAt: { not: null },
    ...(exceptId ? { id: { not: exceptId } } : {}),
  }
  for (const key of keys) {
    const field = 'cidKey' in key ? 'cidKey' : 'emailKey'
    await db.packer.updateMany({ where: { ...where, ...key }, data: { [field]: null } })
  }
}

/**
 * Add a packer to the crew at `crewPhone`. Someone removed earlier with the
 * same CID number or email is restored instead — the same person, with the
 * jobs they worked still attached.
 */
export async function createCrewPacker(
  db: Db,
  crewPhone: string,
  input: PackerInput,
  userId: string,
): Promise<Packer> {
  const p = validatePacker(input, todayIso())
  const keys = identityKeys(p)
  const removed = keys.length
    ? await db.packer.findFirst({ where: { crewPhone, removedAt: { not: null }, OR: keys } })
    : null
  const data = { ...p, cidIssuedOn: toDate(p.cidIssuedOn), updatedByUserId: userId }
  try {
    await releaseRemovedKeys(db, crewPhone, keys, removed?.id)
    return removed
      ? await db.packer.update({ where: { id: removed.id }, data: { ...data, removedAt: null } })
      : await db.packer.create({ data: { crewPhone, ...data, createdByUserId: userId } })
  } catch (err) {
    if (isUniqueViolation(err)) throw packerDuplicate()
    throw err
  }
}

/** Patch a packer on the crew: fields omitted keep their value; null clears. */
export async function updateCrewPacker(
  db: Db,
  crewPhone: string,
  packerId: string,
  input: { [K in keyof PackerInput]?: PackerInput[K] | undefined },
  userId: string,
): Promise<Packer> {
  const existing = await db.packer.findFirst({
    where: { id: packerId, crewPhone, removedAt: null },
  })
  if (!existing) throw packerNotFound()
  const pick = <K extends keyof PackerInput>(k: K, current: string | null) =>
    input[k] === undefined ? current : (input[k] as string | null)
  const p = validatePacker(
    {
      firstName: input.firstName ?? existing.firstName,
      lastName: input.lastName ?? existing.lastName,
      email: pick('email', existing.email),
      cidNumber: pick('cidNumber', existing.cidNumber),
      cidIssuedOn: pick('cidIssuedOn', dateOnly(existing.cidIssuedOn)),
      phone: pick('phone', existing.phone),
    },
    todayIso(),
  )
  try {
    await releaseRemovedKeys(db, crewPhone, identityKeys(p), existing.id)
    return await db.packer.update({
      where: { id: existing.id },
      data: { ...p, cidIssuedOn: toDate(p.cidIssuedOn), updatedByUserId: userId },
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw packerDuplicate()
    throw err
  }
}

/**
 * Remove a packer from the crew. Soft: they stay ticked on the activities they
 * worked (see `keepRemovedSelections`), but can't be newly ticked or edited.
 */
export async function removeCrewPacker(
  db: Db,
  crewPhone: string,
  packerId: string,
  userId: string,
): Promise<void> {
  const { count } = await db.packer.updateMany({
    where: { id: packerId, crewPhone, removedAt: null },
    data: { removedAt: new Date(), updatedByUserId: userId },
  })
  if (count === 0) throw packerNotFound()
}

/**
 * Check a crew's new packer selection on one assignment and complete it.
 * - Every id must be a packer on `crewPhone`.
 * - One newly ticked must still be on the crew.
 * - A removed packer already on the job is kept even when omitted: who worked a
 *   job is history, and a list that no longer shows them must not drop them.
 */
export async function crewSelection(
  db: Pick<PrismaClient, 'packer' | 'activityLaborPacker'>,
  crewPhone: string,
  assignmentId: string | null,
  packerIds: readonly string[],
): Promise<string[]> {
  const current = assignmentId
    ? await db.activityLaborPacker.findMany({
        where: { activityLaborCrewId: assignmentId },
        select: { packerId: true, packer: { select: { removedAt: true } } },
      })
    : []
  const already = new Set(current.map((x) => x.packerId))
  const ids = [...new Set(packerIds)]
  const rows = await db.packer.findMany({
    where: { id: { in: ids } },
    select: { id: true, crewPhone: true, removedAt: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const id of ids) {
    const row = byId.get(id)
    if (!row || row.crewPhone !== crewPhone) {
      throw new LaborHttpError(422, 'PACKER_NOT_ON_CREW', 'A selected packer is not on that crew')
    }
    if (row.removedAt && !already.has(id)) {
      throw new LaborHttpError(422, 'PACKER_REMOVED', 'That packer has been removed from the crew')
    }
  }
  const kept = current.filter((x) => x.packer.removedAt !== null).map((x) => x.packerId)
  return [...new Set([...ids, ...kept])]
}
