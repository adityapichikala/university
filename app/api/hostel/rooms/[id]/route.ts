import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { occupancy } from '@/lib/hostel'

type Ctx = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  block: z.string().trim().min(1).max(40).optional(),
  roomNumber: z.string().trim().min(1).max(20).optional(),
  capacity: z.number().int().min(1).max(20).optional(),
})

const select = { id: true, block: true, roomNumber: true, capacity: true } as const

export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const room = await prisma.hostelRoom.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: {
      ...select,
      allocations: {
        select: {
          id: true,
          allocatedAt: true,
          vacatedAt: true,
          student: { select: { id: true, name: true, regno: true } },
        },
        orderBy: { allocatedAt: 'desc' },
      },
    },
  })
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const { allocations, ...rest } = room
  const live = allocations.filter((a) => a.vacatedAt === null)
  return NextResponse.json({
    room: { ...rest, occupancy: occupancy(room.capacity, live.length), allocations },
  })
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

  const existing = await prisma.hostelRoom.findFirst({
    where: { id, ...scopes.college(ctx) },
    select,
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'hostel',
      actionType: 'HOSTEL_ROOM_UPDATE',
      targetEntity: 'HostelRoom',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  // Shrinking capacity below the number of beds already slept in would make
  // `available` negative and hide an over-occupied room.
  if (parsed.data.capacity !== undefined) {
    const live = await prisma.hostelAllocation.count({ where: { roomId: id, vacatedAt: null } })
    if (parsed.data.capacity < live) {
      await audit({
        ctx,
        agentName: 'hostel',
        actionType: 'HOSTEL_ROOM_UPDATE',
        targetEntity: 'HostelRoom',
        entityId: id,
        status: 'REJECTED',
        after: { reason: 'capacity below live occupants', requested: parsed.data.capacity, live },
      })
      return NextResponse.json(
        { error: `Cannot set capacity to ${parsed.data.capacity}: ${live} student(s) currently occupy this room` },
        { status: 409 }
      )
    }
  }

  const nextBlock = parsed.data.block ?? existing.block
  const nextNumber = parsed.data.roomNumber ?? existing.roomNumber
  if (nextBlock !== existing.block || nextNumber !== existing.roomNumber) {
    const clash = await prisma.hostelRoom.findUnique({
      where: {
        collegeId_block_roomNumber: {
          collegeId: ctx.user.collegeId!,
          block: nextBlock,
          roomNumber: nextNumber,
        },
      },
      select: { id: true },
    })
    if (clash && clash.id !== id) {
      return NextResponse.json(
        { error: `Room ${nextBlock}-${nextNumber} already exists` },
        { status: 409 }
      )
    }
  }

  const room = await prisma.hostelRoom.update({
    where: { id },
    data: {
      block: nextBlock,
      roomNumber: nextNumber,
      ...(parsed.data.capacity !== undefined && { capacity: parsed.data.capacity }),
    },
    select,
  })

  await audit({
    ctx,
    agentName: 'hostel',
    actionType: 'HOSTEL_ROOM_UPDATE',
    targetEntity: 'HostelRoom',
    entityId: id,
    before: {
      block: existing.block,
      roomNumber: existing.roomNumber,
      capacity: existing.capacity,
    },
    after: { block: room.block, roomNumber: room.roomNumber, capacity: room.capacity },
  })

  return NextResponse.json({ room })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.HOSTEL_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const existing = await prisma.hostelRoom.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: {
      id: true,
      block: true,
      roomNumber: true,
      _count: { select: { allocations: { where: { vacatedAt: null } } } },
    },
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'hostel',
      actionType: 'HOSTEL_ROOM_DELETE',
      targetEntity: 'HostelRoom',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  if (existing._count.allocations > 0) {
    await audit({
      ctx,
      agentName: 'hostel',
      actionType: 'HOSTEL_ROOM_DELETE',
      targetEntity: 'HostelRoom',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'still occupied', occupants: existing._count.allocations },
    })
    return NextResponse.json(
      {
        error: `Cannot delete: ${existing._count.allocations} student(s) are still allocated. Vacate them first.`,
      },
      { status: 409 }
    )
  }

  await prisma.hostelRoom.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'hostel',
    actionType: 'HOSTEL_ROOM_DELETE',
    targetEntity: 'HostelRoom',
    entityId: id,
    before: { block: existing.block, roomNumber: existing.roomNumber },
  })

  return NextResponse.json({ ok: true })
}
