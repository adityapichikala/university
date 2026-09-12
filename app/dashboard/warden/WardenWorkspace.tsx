'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/states'
import { useApiMutation } from '@/components/dashboard/use-api-mutation'
import { cn } from '@/lib/utils'

/**
 * The interactive half of the Warden portal: add rooms, allocate a student to
 * one, and vacate a bed. Capacity is enforced by the API, so a full room
 * simply refuses rather than silently over-filling.
 */

export interface RoomRow {
  id: string
  label: string
  block: string
  roomNumber: string
  capacity: number
  occupied: number
  available: number
}

export interface AllocationRow {
  id: string
  studentRegno: string
  studentName: string
  roomId: string
  roomLabel: string
  allocatedAt: string
  vacatedAt: string | null
}

interface Props {
  summary: { rooms: number; capacity: number; occupied: number; freeBeds: number }
  rooms: RoomRow[]
  allocations: AllocationRow[]
  students: { id: string; name: string; regno: string; housed: boolean }[]
}

export function WardenWorkspace({ summary, rooms, allocations, students }: Props) {
  const { run, pending } = useApiMutation()
  const [showHistory, setShowHistory] = React.useState(false)

  const live = allocations.filter((a) => a.vacatedAt === null)

  async function addRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const ok = await run(
      '/api/hostel/rooms',
      'POST',
      {
        block: String(data.get('block') ?? '').trim(),
        roomNumber: String(data.get('roomNumber') ?? '').trim(),
        capacity: Number(data.get('capacity') ?? 3),
      },
      { successTitle: 'Room added' }
    )
    if (ok) form.reset()
  }

  async function allocate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const ok = await run(
      '/api/hostel/allocations',
      'POST',
      {
        studentId: String(data.get('studentId') ?? ''),
        roomId: String(data.get('roomId') ?? ''),
      },
      { successTitle: 'Bed allocated' }
    )
    if (ok) form.reset()
  }

  async function vacate(allocation: AllocationRow) {
    await run(`/api/hostel/allocations/${allocation.id}`, 'PATCH', {}, {
      successTitle: `${allocation.roomLabel} vacated`,
    })
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">Rooms</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
            {summary.rooms}
          </p>
          <p className="mt-1 text-[11px] text-subtle">across all blocks</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Beds</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-foreground">
            {summary.capacity}
          </p>
          <p className="mt-1 text-[11px] text-subtle">total capacity</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Occupied</p>
          <p className="num mt-1 text-3xl font-bold leading-none text-accent">
            {summary.occupied}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {summary.capacity > 0 ? Math.round((summary.occupied / summary.capacity) * 100) : 0}% full
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Free beds</p>
          <p
            className={cn(
              'num mt-1 text-3xl font-bold leading-none',
              summary.freeBeds === 0 ? 'text-danger' : 'text-success'
            )}
          >
            {summary.freeBeds}
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            {summary.freeBeds === 0 ? 'hostel is full' : 'available now'}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Add a room</CardTitle>
            <CardDescription>Block + number is unique within the college.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addRoom} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Block" name="block" placeholder="A" required />
                <Field label="Room no." name="roomNumber" placeholder="101" required />
              </div>
              <Field label="Capacity" name="capacity" type="number" defaultValue="3" required />
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Add room
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Allocate a bed</CardTitle>
            <CardDescription>
              Students who already hold a bed are hidden — one bed each.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={allocate} className="space-y-3">
              <label className="block text-xs font-medium text-muted">
                Student
                <select
                  name="studentId"
                  required
                  className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select a student…</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id} disabled={s.housed}>
                      {s.regno} — {s.name}
                      {s.housed ? ' (already housed)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-muted">
                Room
                <select
                  name="roomId"
                  required
                  className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select a room…</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id} disabled={r.available <= 0}>
                      {r.label} — {r.occupied}/{r.capacity}
                      {r.available <= 0 ? ' (full)' : ` (${r.available} free)`}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Allocate
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rooms</CardTitle>
          <CardDescription>Occupancy is counted from live allocations, never cached.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {rooms.length === 0 ? (
            <div className="px-6">
              <EmptyState icon="door_front" title="No rooms yet" description="Add your first room above." />
            </div>
          ) : (
            <div className="grid gap-3 px-6 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-border bg-background p-4 transition-shadow hover:shadow-soft"
                >
                  <div className="flex items-center justify-between">
                    <p className="num text-lg font-bold text-foreground">{r.label}</p>
                    <span
                      className={cn(
                        'num rounded-lg px-2 py-1 text-xs font-semibold',
                        r.available === 0
                          ? 'bg-danger-soft text-danger'
                          : r.available === r.capacity
                            ? 'bg-slate-100 text-muted'
                            : 'bg-success-soft text-success'
                      )}
                    >
                      {r.available} free
                    </span>
                  </div>
                  <p className="num mt-1 text-xs text-muted">
                    {r.occupied} / {r.capacity} beds taken
                  </p>
                  <div className="mt-2 flex gap-1">
                    {Array.from({ length: r.capacity }).map((_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-1.5 flex-1 rounded-full',
                          i < r.occupied ? 'bg-accent' : 'bg-border'
                        )}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allocations</CardTitle>
          <CardDescription>
            {live.length} live · {allocations.length - live.length} vacated
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {live.length === 0 ? (
            <div className="px-6">
              <EmptyState
                icon="bed"
                title="No student is housed yet"
                description="Allocate a student to a room using the form above."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 text-left font-medium">Student</th>
                    <th className="px-4 py-2.5 text-left font-medium">Room</th>
                    <th className="px-4 py-2.5 text-left font-medium">Since</th>
                    <th className="px-4 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {live.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <span className="num text-accent">{a.studentRegno}</span>
                        <p className="text-xs text-subtle">{a.studentName}</p>
                      </td>
                      <td className="num px-4 py-3 font-medium text-foreground">{a.roomLabel}</td>
                      <td className="num px-4 py-3 text-muted">{a.allocatedAt}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => vacate(a)}
                        >
                          Vacate
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {allocations.length > live.length ? (
            <div className="px-6 pt-4">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="text-xs font-medium text-accent hover:underline"
              >
                {showHistory ? 'Hide' : 'Show'} vacated beds ({allocations.length - live.length})
              </button>

              {showHistory ? (
                <ul className="mt-3 space-y-1">
                  {allocations
                    .filter((a) => a.vacatedAt !== null)
                    .map((a) => (
                      <li key={a.id} className="num text-xs text-subtle">
                        {a.studentRegno} · {a.roomLabel} · {a.allocatedAt} → {a.vacatedAt}
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  defaultValue,
  required,
}: {
  label: string
  name: string
  type?: string
  placeholder?: string
  defaultValue?: string
  required?: boolean
}) {
  return (
    <label className="block text-xs font-medium text-muted">
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className={cn(
          'mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle',
          type === 'number' && 'num'
        )}
      />
    </label>
  )
}
