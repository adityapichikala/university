import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { HOSTEL_ALLOCATION_SELECT } from '@/lib/hostel-query'

/**
 * One hostel allocation: read it, vacate it, or void the row.
 *
 * Vacating is a soft delete — `vacatedAt` is stamped and the bed becomes
 * free, while the row stays for the audit trail and for room history.
 */

type Ctx = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  /** Omit to use the current time. */
  vacatedAt: z.string().trim().optional(),
})

export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const allocation = await prisma.hostelAllocation.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: HOSTEL_ALLOCATION_SELECT,
  })
  if (!allocation) return NextResponse.json({ error: 'Allocation not found' }, { status: 404 })

  if (!ctx.can(PERMISSIONS.HOSTEL_MANAGE) && allocation.student.id !== ctx.user.id) {
    return NextResponse.json({ error: 'Allocation not found' }, { status: 404 })
  }

  return NextResponse.json({ allocation })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.HOSTEL_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const existing = await prisma.hostelAllocation.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: HOSTEL_ALLOCATION_SELECT,
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'hostel',
      actionType: 'HOSTEL_VACATE',
      targetEntity: 'HostelAllocation',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Allocation not found' }, { status: 404 })
  }

  if (existing.vacatedAt) {
    return NextResponse.json({ error: 'This bed is already vacated' }, { status: 409 })
  }

  const vacatedAt = parsed.data.vacatedAt ? new Date(parsed.data.vacatedAt) : new Date()
  if (Number.isNaN(vacatedAt.getTime())) {
    return NextResponse.json({ error: 'vacatedAt must be an ISO date' }, { status: 400 })
  }
  if (vacatedAt.getTime() < existing.allocatedAt.getTime()) {
    return NextResponse.json(
      { error: 'vacatedAt cannot be before the allocation date' },
      { status: 400 }
    )
  }

  const allocation = await prisma.hostelAllocation.updateMany({
    where: { id, vacatedAt: null },
    data: { vacatedAt },
  })
  if (allocation.count === 0) {
    return NextResponse.json({ error: 'This bed is already vacated' }, { status: 409 })
  }

  const updated = await prisma.hostelAllocation.findUnique({
    where: { id },
    select: HOSTEL_ALLOCATION_SELECT,
  })

  await audit({
    ctx,
    agentName: 'hostel',
    actionType: 'HOSTEL_VACATE',
    targetEntity: 'HostelAllocation',
    entityId: id,
    before: { vacatedAt: null },
    after: {
      student: existing.student.regno,
      room: `${existing.room.block}-${existing.room.roomNumber}`,
      vacatedAt: vacatedAt.toISOString(),
    },
  })

  return NextResponse.json({ allocation: updated })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.HOSTEL_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const existing = await prisma.hostelAllocation.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: HOSTEL_ALLOCATION_SELECT,
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'hostel',
      actionType: 'HOSTEL_ALLOCATION_DELETE',
      targetEntity: 'HostelAllocation',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Allocation not found' }, { status: 404 })
  }

  // Hard-deleting a live allocation would make the room look empty while the
  // student still sleeps there. Vacate first, then the row is safe to remove.
  if (!existing.vacatedAt) {
    await audit({
      ctx,
      agentName: 'hostel',
      actionType: 'HOSTEL_ALLOCATION_DELETE',
      targetEntity: 'HostelAllocation',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'still occupied', student: existing.student.regno },
    })
    return NextResponse.json(
      { error: 'Cannot delete a live allocation — vacate it first' },
      { status: 409 }
    )
  }

  await prisma.hostelAllocation.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'hostel',
    actionType: 'HOSTEL_ALLOCATION_DELETE',
    targetEntity: 'HostelAllocation',
    entityId: id,
    before: {
      student: existing.student.regno,
      room: `${existing.room.block}-${existing.room.roomNumber}`,
    },
  })

  return NextResponse.json({ ok: true })
}
