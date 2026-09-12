import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { roomLabel } from '@/lib/hostel'
import { HOSTEL_ALLOCATION_SELECT } from '@/lib/hostel-query'
import { ToastProvider } from '@/components/ui/toast'
import { WardenWorkspace } from './WardenWorkspace'
import { HostelLeaveQueue } from './HostelLeaveQueue'

export const metadata = { title: 'Hostel · Apex University ERP' }

/**
 * Warden portal (Phase 3, doc §7).
 *
 * Guarded by `hostel.manage`. Occupancy is derived from live allocations, so
 * the numbers here cannot be stale even if a bed is vacated elsewhere.
 */
export default async function WardenPage() {
  const ctx = await requirePermission(PERMISSIONS.HOSTEL_MANAGE, { route: 'warden' })

  const [rooms, allocations, students] = await Promise.all([
    prisma.hostelRoom.findMany({
      where: scopes.college(ctx),
      select: { id: true, block: true, roomNumber: true, capacity: true },
      orderBy: [{ block: 'asc' }, { roomNumber: 'asc' }],
      take: 300,
    }),
    prisma.hostelAllocation.findMany({
      where: scopes.college(ctx),
      select: HOSTEL_ALLOCATION_SELECT,
      orderBy: [{ vacatedAt: 'asc' }, { allocatedAt: 'desc' }],
      take: 500,
    }),
    prisma.user.findMany({
      where: { ...scopes.college(ctx), role: 'STUDENT' },
      select: { id: true, name: true, regno: true },
      orderBy: { regno: 'asc' },
    }),
  ])

  // A student without a bed can still file leave, so the queue is queried
  // independently of allocations and joined in memory by student id.
  const leaves = await prisma.hostelLeave.findMany({
    where: scopes.college(ctx),
    select: {
      id: true,
      fromDate: true,
      toDate: true,
      reason: true,
      status: true,
      decisionNote: true,
      decidedAt: true,
      studentId: true,
      student: { select: { name: true, regno: true } },
    },
    orderBy: [{ status: 'asc' }, { fromDate: 'asc' }],
    take: 300,
  })

  const bedByStudent = new Map<string, string>()
  for (const a of allocations) {
    if (a.vacatedAt) continue
    bedByStudent.set(a.student.id, roomLabel(a.room.block, a.room.roomNumber))
  }

  const leaveRows = leaves.map((l) => ({
    id: l.id,
    studentRegno: l.student.regno,
    studentName: l.student.name,
    roomLabel: bedByStudent.get(l.studentId) ?? null,
    fromDate: l.fromDate.toISOString().slice(0, 10),
    toDate: l.toDate.toISOString().slice(0, 10),
    nights: Math.max(1, Math.round((l.toDate.getTime() - l.fromDate.getTime()) / 86_400_000)),
    reason: l.reason,
    status: l.status,
    note: l.decisionNote,
    decidedAt: l.decidedAt ? l.decidedAt.toISOString().slice(0, 10) : null,
  }))

  // One pass over the allocations, then fold it into each room.
  const liveByRoom = new Map<string, number>()
  for (const a of allocations) {
    if (a.vacatedAt) continue
    liveByRoom.set(a.room.id, (liveByRoom.get(a.room.id) ?? 0) + 1)
  }

  const roomRows = rooms.map((r) => ({
    id: r.id,
    label: roomLabel(r.block, r.roomNumber),
    block: r.block,
    roomNumber: r.roomNumber,
    capacity: r.capacity,
    occupied: liveByRoom.get(r.id) ?? 0,
    available: Math.max(0, r.capacity - (liveByRoom.get(r.id) ?? 0)),
  }))

  const totalCapacity = roomRows.reduce((sum, r) => sum + r.capacity, 0)
  const totalOccupied = roomRows.reduce((sum, r) => sum + r.occupied, 0)

  // A student holding a live bed is not offered for allocation again.
  const housed = new Set(allocations.filter((a) => !a.vacatedAt).map((a) => a.student.id))

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Hostel</h1>
        <p className="mt-1 text-sm text-muted">
          Rooms, beds and allocations. Vacating a bed frees it immediately while keeping the
          history.
        </p>
      </div>

      <ToastProvider>
        <WardenWorkspace
          summary={{
            rooms: roomRows.length,
            capacity: totalCapacity,
            occupied: totalOccupied,
            freeBeds: Math.max(0, totalCapacity - totalOccupied),
          }}
          rooms={roomRows}
          allocations={allocations.map((a) => ({
            id: a.id,
            studentRegno: a.student.regno,
            studentName: a.student.name,
            roomId: a.room.id,
            roomLabel: roomLabel(a.room.block, a.room.roomNumber),
            allocatedAt: a.allocatedAt.toISOString().slice(0, 10),
            vacatedAt: a.vacatedAt ? a.vacatedAt.toISOString().slice(0, 10) : null,
          }))}
          students={students.map((s) => ({ ...s, housed: housed.has(s.id) }))}
        />

        <div className="mt-6">
          <HostelLeaveQueue
            rows={leaveRows}
            // Passed rather than assumed: the queue adapts to the caller's real
            // grant, so widening this page's guard later cannot leave dead
            // decision controls on screen.
            canDecide={ctx.can(PERMISSIONS.HOSTEL_MANAGE)}
          />
        </div>
      </ToastProvider>
    </div>
  )
}
