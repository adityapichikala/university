import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { canAllocate, occupancy } from '@/lib/hostel'
import { HOSTEL_ALLOCATION_SELECT, hostelAllocationScope } from '@/lib/hostel-query'

/**
 * Hostel allocations (Phase 3, doc §7).
 *
 * Two invariants guard every allocation:
 *   1. a room never exceeds its capacity
 *   2. a student never holds two live beds
 * Both are re-checked inside the write transaction, because a check followed
 * by an insert is a race, not a guarantee.
 */

const createSchema = z.object({
  studentId: z.string().trim().min(1, 'studentId is required'),
  roomId: z.string().trim().min(1, 'roomId is required'),
})

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const active = req.nextUrl.searchParams.get('active')
  const studentId = req.nextUrl.searchParams.get('studentId')
  const canManage = ctx.can(PERMISSIONS.HOSTEL_MANAGE)

  const rows = await prisma.hostelAllocation.findMany({
    where: {
      ...hostelAllocationScope(ctx),
      // Only a warden may pivot to another student's bed.
      ...(studentId && canManage ? { studentId } : {}),
      ...(active === '1' && { vacatedAt: null }),
      ...(active === '0' && { vacatedAt: { not: null } }),
    },
    select: HOSTEL_ALLOCATION_SELECT,
    orderBy: [{ vacatedAt: 'asc' }, { allocatedAt: 'desc' }],
    take: 500,
  })

  return NextResponse.json({ allocations: rows })
}

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.HOSTEL_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const [student, room] = await Promise.all([
    prisma.user.findFirst({
      where: { id: parsed.data.studentId, ...scopes.college(ctx), role: 'STUDENT' },
      select: { id: true, name: true, regno: true },
    }),
    prisma.hostelRoom.findFirst({
      where: { id: parsed.data.roomId, ...scopes.college(ctx) },
      select: { id: true, block: true, roomNumber: true, capacity: true },
    }),
  ])

  if (!student || !room) {
    await audit({
      ctx,
      agentName: 'hostel',
      actionType: 'HOSTEL_ALLOCATE',
      targetEntity: 'HostelAllocation',
      status: 'REJECTED',
      after: {
        reason: !student ? 'student not found' : 'room not found',
        studentId: parsed.data.studentId,
        roomId: parsed.data.roomId,
      },
    })
    return NextResponse.json(
      { error: !student ? 'Student not found in your college' : 'Room not found' },
      { status: 404 }
    )
  }

  const [liveInRoom, liveForStudent, alreadyHere] = await Promise.all([
    prisma.hostelAllocation.count({ where: { roomId: room.id, vacatedAt: null } }),
    prisma.hostelAllocation.count({ where: { studentId: student.id, vacatedAt: null } }),
    prisma.hostelAllocation.count({
      where: { roomId: room.id, studentId: student.id, vacatedAt: null },
    }),
  ])

  const decision = canAllocate({
    capacity: room.capacity,
    liveAllocations: liveInRoom,
    studentHasLiveBed: liveForStudent > 0,
    studentAlreadyInThisRoom: alreadyHere > 0,
  })

  if (!decision.ok) {
    await audit({
      ctx,
      agentName: 'hostel',
      actionType: 'HOSTEL_ALLOCATE',
      targetEntity: 'HostelAllocation',
      status: 'REJECTED',
      after: {
        reason: decision.reason,
        student: student.regno,
        room: `${room.block}-${room.roomNumber}`,
      },
    })
    return NextResponse.json({ error: decision.reason }, { status: 409 })
  }

  // Re-check inside the transaction: two wardens clicking at once would
  // otherwise both pass the count above and oversell the last bed.
  const allocation = await prisma.$transaction(async (tx) => {
    const live = await tx.hostelAllocation.count({ where: { roomId: room.id, vacatedAt: null } })
    if (occupancy(room.capacity, live).full) throw new Error('ROOM_FULL')

    const held = await tx.hostelAllocation.count({
      where: { studentId: student.id, vacatedAt: null },
    })
    if (held > 0) throw new Error('ALREADY_ALLOCATED')

    return tx.hostelAllocation.create({
      data: { collegeId: ctx.user.collegeId!, studentId: student.id, roomId: room.id },
      select: HOSTEL_ALLOCATION_SELECT,
    })
  }).catch((error: unknown) => {
    if (error instanceof Error && (error.message === 'ROOM_FULL' || error.message === 'ALREADY_ALLOCATED')) {
      return error.message
    }
    throw error
  })

  if (typeof allocation === 'string') {
    return NextResponse.json(
      {
        error:
          allocation === 'ROOM_FULL'
            ? 'That room just filled up — pick another'
            : 'That student just received a bed elsewhere',
      },
      { status: 409 }
    )
  }

  await audit({
    ctx,
    agentName: 'hostel',
    actionType: 'HOSTEL_ALLOCATE',
    targetEntity: 'HostelAllocation',
    entityId: allocation.id,
    after: {
      student: student.regno,
      room: `${room.block}-${room.roomNumber}`,
      bedsTaken: liveInRoom + 1,
      capacity: room.capacity,
    },
  })

  return NextResponse.json({ allocation }, { status: 201 })
}
