import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { occupancy } from '@/lib/hostel'

/**
 * Hostel rooms (Phase 3, doc §7).
 *
 * Rooms are inventory: readable by the college, writable only under
 * `hostel.manage`. Occupancy is always derived from live allocations rather
 * than stored, so a room can never claim a bed that is already taken.
 */

const createSchema = z.object({
  block: z.string().trim().min(1).max(40),
  roomNumber: z.string().trim().min(1).max(20),
  capacity: z.number().int().min(1).max(20),
})

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const block = req.nextUrl.searchParams.get('block')?.trim()
  const withSpace = req.nextUrl.searchParams.get('available') === '1'

  const rooms = await prisma.hostelRoom.findMany({
    where: { ...scopes.college(ctx), ...(block && { block }) },
    select: {
      id: true,
      block: true,
      roomNumber: true,
      capacity: true,
      allocations: {
        where: { vacatedAt: null },
        select: { id: true, student: { select: { id: true, name: true, regno: true } } },
      },
    },
    orderBy: [{ block: 'asc' }, { roomNumber: 'asc' }],
    take: 300,
  })

  const shaped = rooms
    .map((room) => {
      const { allocations, ...rest } = room
      return { ...rest, occupancy: occupancy(room.capacity, allocations.length), occupants: allocations }
    })
    .filter((room) => !withSpace || room.occupancy.available > 0)

  return NextResponse.json({ rooms: shaped })
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

  const duplicate = await prisma.hostelRoom.findUnique({
    where: {
      collegeId_block_roomNumber: {
        collegeId: ctx.user.collegeId,
        block: parsed.data.block,
        roomNumber: parsed.data.roomNumber,
      },
    },
    select: { id: true },
  })
  if (duplicate) {
    return NextResponse.json(
      { error: `Room ${parsed.data.block}-${parsed.data.roomNumber} already exists` },
      { status: 409 }
    )
  }

  const room = await prisma.hostelRoom.create({
    data: {
      collegeId: ctx.user.collegeId,
      block: parsed.data.block,
      roomNumber: parsed.data.roomNumber,
      capacity: parsed.data.capacity,
    },
    select: { id: true, block: true, roomNumber: true, capacity: true },
  })

  await audit({
    ctx,
    agentName: 'hostel',
    actionType: 'HOSTEL_ROOM_CREATE',
    targetEntity: 'HostelRoom',
    entityId: room.id,
    after: { block: room.block, roomNumber: room.roomNumber, capacity: room.capacity },
  })

  return NextResponse.json({ room }, { status: 201 })
}
