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

/** Add a packer to the crew at `crewPhone`. */
export async function createCrewPacker(
  db: Db,
  crewPhone: string,
  input: PackerInput,
  userId: string,
): Promise<Packer> {
  const p = validatePacker(input, todayIso())
  try {
    return await db.packer.create({
      data: {
        crewPhone,
        ...p,
        cidIssuedOn: toDate(p.cidIssuedOn),
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw packerDuplicate()
    throw err
  }
}

/** Patch a packer of the crew: fields omitted keep their value; null clears. */
export async function updateCrewPacker(
  db: Db,
  crewPhone: string,
  packerId: string,
  input: { [K in keyof PackerInput]?: PackerInput[K] | undefined },
  userId: string,
): Promise<Packer> {
  const existing = await db.packer.findFirst({ where: { id: packerId, crewPhone } })
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
    return await db.packer.update({
      where: { id: existing.id },
      data: { ...p, cidIssuedOn: toDate(p.cidIssuedOn), updatedByUserId: userId },
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw packerDuplicate()
    throw err
  }
}

/** Delete a packer of the crew (its activity selections cascade). */
export async function deleteCrewPacker(db: Db, crewPhone: string, packerId: string): Promise<void> {
  const { count } = await db.packer.deleteMany({ where: { id: packerId, crewPhone } })
  if (count === 0) throw packerNotFound()
}
