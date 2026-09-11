import { prisma } from '@/lib/db'
import { requireUser, scopes } from '@/lib/rbac'
import { HOSTEL_ALLOCATION_SELECT } from '@/lib/hostel-query'
import { occupancy, roomLabel } from '@/lib/hostel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'

export const metadata = { title: 'My Hostel · Apex University ERP' }

/**
 * Student › My Hostel.
 *
 * Shows the student's own bed plus who they share with. Sharing roommates is
 * intentional — a student living in a room already knows who is in it.
 */
export default async function StudentHostelPage() {
  const ctx = await requireUser({ route: 'student' })

  const allocations = await prisma.hostelAllocation.findMany({
    where: { ...scopes.college(ctx), studentId: ctx.user.id },
    select: HOSTEL_ALLOCATION_SELECT,
    orderBy: { allocatedAt: 'desc' },
  })

  const current = allocations.find((a) => a.vacatedAt === null) ?? null
  const history = allocations.filter((a) => a.vacatedAt !== null)

  // Roommates only make sense for a live bed.
  const roommates = current
    ? await prisma.hostelAllocation.findMany({
        where: {
          ...scopes.college(ctx),
          roomId: current.room.id,
          vacatedAt: null,
          studentId: { not: ctx.user.id },
        },
        select: { id: true, student: { select: { id: true, name: true, regno: true } } },
        orderBy: { student: { regno: 'asc' } },
      })
    : []

  const roomOccupancy = current
    ? await prisma.hostelAllocation.count({
        where: { ...scopes.college(ctx), roomId: current.room.id, vacatedAt: null },
      })
    : 0

  const occ = current ? occupancy(current.room.capacity, roomOccupancy) : null

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">My Hostel</h1>
        <p className="mt-1 text-sm text-muted">
          Your room allocation and occupancy. Contact the warden to request a change.
        </p>
      </div>

      {current && occ ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs text-muted">Room</p>
              <p className="num mt-1 text-3xl font-bold leading-none text-accent">
                {roomLabel(current.room.block, current.room.roomNumber)}
              </p>
              <p className="mt-1 text-[11px] text-subtle">block {current.room.block}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs text-muted">Occupancy</p>
              <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
                {occ.occupied}
                <span className="text-base font-normal text-muted">/{occ.capacity}</span>
              </p>
              <p className="mt-1 text-[11px] text-subtle">
                {occ.available} bed{occ.available === 1 ? '' : 's'} free
              </p>
            </Card>

            <Card className="p-4">
              <p className="text-xs text-muted">Roommates</p>
              <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
                {roommates.length}
              </p>
              <p className="mt-1 text-[11px] text-subtle">sharing this room</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs text-muted">Since</p>
              <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
                {current.allocatedAt.toISOString().slice(0, 10)}
              </p>
              <p className="mt-1 text-[11px] text-subtle">allocation date</p>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>
                Room {roomLabel(current.room.block, current.room.roomNumber)}
              </CardTitle>
              <CardDescription>
                Students currently allocated to this room.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 text-left font-medium">Reg no.</th>
                      <th className="px-4 py-2.5 text-left font-medium">Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border">
                      <td className="num px-4 py-3 font-medium text-accent">
                        {ctx.user.regno}
                        <span className="ml-2 text-[11px] font-normal text-subtle">you</span>
                      </td>
                      <td className="px-4 py-3 text-muted">{ctx.user.name}</td>
                    </tr>
                    {roommates.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="num px-4 py-3 font-medium text-foreground">
                          {r.student.regno}
                        </td>
                        <td className="px-4 py-3 text-muted">{r.student.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <EmptyState
          icon="hotel"
          title="No room allocated"
          description="You do not currently hold a bed. The warden allocates rooms — check back once one is assigned to you."
        />
      )}

      {history.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Past rooms</CardTitle>
            <CardDescription>Rooms you have vacated stay on record.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 text-left font-medium">Room</th>
                    <th className="px-4 py-2.5 text-left font-medium">Allocated</th>
                    <th className="px-4 py-2.5 text-left font-medium">Vacated</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <td className="num px-4 py-3 font-medium text-foreground">
                        {roomLabel(a.room.block, a.room.roomNumber)}
                      </td>
                      <td className="num px-4 py-3 text-muted">
                        {a.allocatedAt.toISOString().slice(0, 10)}
                      </td>
                      <td className="num px-4 py-3 text-muted">
                        {a.vacatedAt ? a.vacatedAt.toISOString().slice(0, 10) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
