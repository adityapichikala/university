'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { ErrorState, Spinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { WeekGrid } from '@/components/timetable/week-grid'
import { cn } from '@/lib/utils'
import {
  WEEKDAYS,
  timeRange,
  weekdayLabel,
  type GridSlot,
  type SlotConflict,
} from '@/lib/timetable'

/**
 * Teacher › Timetable.
 *
 * Read the week, add a slot, click a slot to move or delete it. Every write
 * goes through PATCH/POST /api/timetable, which re-checks conflicts server-side
 * — the 409 body is rendered as a list, because "room taken" and "you are
 * already teaching" are different problems and the teacher needs to know which.
 */

export interface CourseOption {
  id: string
  code: string
  name: string
}

export interface SectionOption {
  id: string
  name: string
}

const BLANK = {
  courseId: '',
  classId: '',
  dayOfWeek: '1',
  startTime: '09:00',
  endTime: '10:00',
  room: '',
}

const KIND_LABEL: Record<string, string> = {
  CLASS: 'Section clash',
  TEACHER: 'Teacher clash',
  ROOM: 'Room booked',
  TIME: 'Invalid time',
}

export function TimetableEditor({
  courses,
  sections,
  initialSlots,
}: {
  courses: CourseOption[]
  sections: SectionOption[]
  initialSlots: GridSlot[]
}) {
  const { success, error: toastError } = useToast()

  const [slots, setSlots] = React.useState(initialSlots)
  const [showCreate, setShowCreate] = React.useState(false)
  const [form, setForm] = React.useState({
    ...BLANK,
    courseId: courses[0]?.id ?? '',
    classId: sections[0]?.id ?? '',
  })
  const [saving, setSaving] = React.useState(false)
  const [conflicts, setConflicts] = React.useState<SlotConflict[]>([])

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const selected = slots.find((s) => s.id === selectedId) ?? null
  const today = new Date().getDay()

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  /** Turn a 409 body into a list; anything else is a plain error. */
  async function readError(res: Response): Promise<{ message: string; conflicts: SlotConflict[] }> {
    const data = await res.json().catch(() => ({}))
    return {
      message: (data.error as string) ?? 'Request failed',
      conflicts: Array.isArray(data.conflicts) ? (data.conflicts as SlotConflict[]) : [],
    }
  }

  async function createSlot(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setConflicts([])
    try {
      const res = await fetch('/api/timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: form.courseId,
          classId: form.classId,
          dayOfWeek: Number(form.dayOfWeek),
          startTime: form.startTime,
          endTime: form.endTime,
          room: form.room,
        }),
      })
      if (!res.ok) {
        const { message, conflicts: found } = await readError(res)
        setConflicts(found)
        throw new Error(message)
      }
      const data = await res.json()
      setSlots((current) =>
        [...current, mapSlot(data.slot)].sort(
          (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)
        )
      )
      setForm((current) => ({ ...current, room: '' }))
      setShowCreate(false)
      success('Slot added', `${data.slot.course.code} · ${timeRange(data.slot.startTime, data.slot.endTime)}`)
    } catch (err) {
      toastError('Could not add slot', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  async function deleteSlot() {
    if (!selected) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/timetable/${selected.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const { message } = await readError(res)
        throw new Error(message)
      }
      setSlots((current) => current.filter((s) => s.id !== selected.id))
      success('Slot removed', `${selected.courseCode} · ${weekdayLabel(selected.dayOfWeek)}`)
      setSelectedId(null)
    } catch (err) {
      toastError('Could not remove slot', err instanceof Error ? err.message : undefined)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={showCreate ? 'outline' : 'accent'} onClick={() => setShowCreate((v) => !v)}>
          <span className="material-symbols-outlined text-[16px] leading-none">
            {showCreate ? 'close' : 'add'}
          </span>
          {showCreate ? 'Cancel' : 'Add slot'}
        </Button>
        {selected ? (
          <>
            <span className="num text-xs text-muted">
              {selected.courseCode} · {weekdayLabel(selected.dayOfWeek)} ·{' '}
              {timeRange(selected.startTime, selected.endTime)} · {selected.room}
            </span>
            <Button size="sm" variant="danger" disabled={deleting} onClick={deleteSlot}>
              {deleting ? <Spinner className="text-[14px]" /> : null}
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
              Clear
            </Button>
          </>
        ) : (
          <span className="text-xs text-subtle">Click a slot to select it.</span>
        )}
      </div>

      {showCreate ? (
        <Card className="p-5">
          <form onSubmit={createSlot} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tt-course">Course</Label>
                <select
                  id="tt-course"
                  value={form.courseId}
                  onChange={(e) => set('courseId', e.target.value)}
                  className="h-10 w-full rounded-xl border border-border-strong bg-surface px-3 text-sm text-foreground"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tt-class">Section</Label>
                <select
                  id="tt-class"
                  value={form.classId}
                  onChange={(e) => set('classId', e.target.value)}
                  className="h-10 w-full rounded-xl border border-border-strong bg-surface px-3 text-sm text-foreground"
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tt-day">Day</Label>
                <select
                  id="tt-day"
                  value={form.dayOfWeek}
                  onChange={(e) => set('dayOfWeek', e.target.value)}
                  className="h-10 w-full rounded-xl border border-border-strong bg-surface px-3 text-sm text-foreground"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={String(d.value)}>
                      {d.long}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tt-room">Room</Label>
                <Input
                  id="tt-room"
                  value={form.room}
                  onChange={(e) => set('room', e.target.value)}
                  placeholder="A-204"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tt-start">Start</Label>
                <Input
                  id="tt-start"
                  type="time"
                  value={form.startTime}
                  onChange={(e) => set('startTime', e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tt-end">End</Label>
                <Input
                  id="tt-end"
                  type="time"
                  value={form.endTime}
                  onChange={(e) => set('endTime', e.target.value)}
                  required
                />
              </div>
            </div>

            {conflicts.length > 0 ? (
              <div
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger-soft/40 p-3"
              >
                <p className="text-xs font-semibold text-foreground">
                  This slot clashes with {conflicts.length} existing{' '}
                  {conflicts.length === 1 ? 'entry' : 'entries'}
                </p>
                <ul className="mt-2 space-y-1">
                  {conflicts.map((c, i) => (
                    <li key={`${c.kind}-${c.slotId ?? i}`} className="flex gap-2 text-xs text-muted">
                      <span className="num shrink-0 font-semibold text-danger">
                        {KIND_LABEL[c.kind] ?? c.kind}
                      </span>
                      <span>{c.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? <Spinner className="text-[14px]" /> : null}
                {saving ? 'Saving…' : 'Save slot'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <WeekGrid
        slots={slots}
        today={today}
        selectedId={selectedId}
        onSlotClick={(slot) => setSelectedId((current) => (current === slot.id ? null : slot.id))}
        emptyTitle="No slots yet"
        emptyHint="Add your first slot and the week grid will build itself around it."
      />

      {slots.length > 0 ? (
        <Card className="p-4">
          <h2 className="font-heading text-sm font-semibold text-foreground">Your week</h2>
          <div className="mt-3 space-y-1.5">
            {WEEKDAYS.map((day) => {
              const daySlots = slots.filter((s) => s.dayOfWeek === day.value)
              return (
                <div key={day.value} className="flex items-start gap-3">
                  <span
                    className={cn(
                      'num w-10 shrink-0 pt-0.5 text-[11px] font-semibold',
                      day.value === today ? 'text-accent' : 'text-subtle'
                    )}
                  >
                    {day.short}
                  </span>
                  {daySlots.length === 0 ? (
                    <span className="pt-0.5 text-[11px] text-subtle">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {daySlots.map((slot) => (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() =>
                            setSelectedId((current) => (current === slot.id ? null : slot.id))
                          }
                          className={cn(
                            'num rounded-lg border px-2 py-1 text-[11px] transition-colors',
                            selectedId === slot.id
                              ? 'border-accent bg-accent text-white'
                              : 'border-border bg-background text-muted hover:border-accent/40 hover:text-accent'
                          )}
                        >
                          {slot.courseCode} {timeRange(slot.startTime, slot.endTime)} · {slot.room}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      ) : null}

      {courses.length === 0 ? (
        <ErrorState
          title="No courses assigned"
          description="You are not teaching any course yet, so there is nothing to schedule."
        />
      ) : null}
    </div>
  )
}

function mapSlot(raw: {
  id: string
  dayOfWeek: number
  startTime: string
  endTime: string
  room: string
  course: { id: string; code: string; name: string; teacher?: { name: string | null } | null }
  class: { id: string; name: string }
}): GridSlot {
  return {
    id: raw.id,
    courseId: raw.course.id,
    courseCode: raw.course.code,
    courseName: raw.course.name,
    teacherName: raw.course.teacher?.name ?? null,
    className: raw.class.name,
    room: raw.room,
    startTime: raw.startTime,
    endTime: raw.endTime,
    dayOfWeek: raw.dayOfWeek,
  }
}
