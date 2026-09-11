import type { PrismaClient } from '@prisma/client'

/**
 * Timetable domain logic (Wave 4).
 *
 * Kept out of the route handlers so the API, the server components and the
 * seed all agree on what "a valid slot" and "a clash" mean.
 */

/** The schema stores 0=Sunday…6=Saturday. Teaching weeks run Mon–Sat. */
export const WEEKDAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
] as const

export type Weekday = (typeof WEEKDAYS)[number]['value']

export const WEEKDAY_VALUES = WEEKDAYS.map((d) => d.value)

export function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && (WEEKDAY_VALUES as readonly number[]).includes(value)
}

export function weekdayLabel(value: number): string {
  return WEEKDAYS.find((d) => d.value === value)?.long ?? `Day ${value}`
}

/** Zero-padded 24-hour "HH:MM". Lexicographic order == chronological order. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value)
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Half-open intervals [start, end) — back-to-back slots must NOT clash. */
export function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && bStart < aEnd
}

export function durationMinutes(startTime: string, endTime: string): number {
  return toMinutes(endTime) - toMinutes(startTime)
}

/** "09:00 – 10:00" → "09:00–10:00" with a proper en dash for display. */
export function timeRange(startTime: string, endTime: string): string {
  return `${startTime}–${endTime}`
}

// ── Conflicts ───────────────────────────────────────────────────────────────

export type ConflictKind = 'CLASS' | 'TEACHER' | 'ROOM' | 'TIME'

export interface SlotConflict {
  kind: ConflictKind
  message: string
  /** The offending existing slot, when the clash is with another row. */
  slotId?: string
  detail?: string
}

export interface SlotInput {
  collegeId: string
  courseId: string
  classId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  room: string
}

/**
 * Every reason this slot cannot be saved. Returns ALL conflicts rather than the
 * first one, so the UI can show a useful message instead of whack-a-mole.
 *
 * `excludeId` is the slot being edited — a row never clashes with itself.
 */
export async function findConflicts(
  prisma: PrismaClient,
  input: SlotInput,
  excludeId?: string
): Promise<SlotConflict[]> {
  const conflicts: SlotConflict[] = []

  if (toMinutes(input.endTime) <= toMinutes(input.startTime)) {
    conflicts.push({
      kind: 'TIME',
      message: 'End time must be after start time',
      detail: `${input.startTime} → ${input.endTime}`,
    })
  }

  const course = await prisma.course.findUnique({
    where: { id: input.courseId },
    select: { id: true, code: true, name: true, teacherId: true },
  })
  if (!course) {
    conflicts.push({ kind: 'TIME', message: 'Course not found', detail: input.courseId })
    return conflicts
  }

  // Overlap is a pure string comparison thanks to zero-padded HH:MM.
  const overlapping = await prisma.timetableSlot.findMany({
    where: {
      collegeId: input.collegeId,
      dayOfWeek: input.dayOfWeek,
      startTime: { lt: input.endTime },
      endTime: { gt: input.startTime },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: {
      id: true,
      classId: true,
      room: true,
      startTime: true,
      endTime: true,
      course: { select: { code: true, name: true, teacherId: true } },
      class: { select: { name: true } },
    },
  })

  const range = timeRange(input.startTime, input.endTime)

  for (const slot of overlapping) {
    // Same section cannot sit two classes at once.
    if (slot.classId === input.classId) {
      conflicts.push({
        kind: 'CLASS',
        slotId: slot.id,
        message: `${slot.class.name} already has ${slot.course.code} at ${timeRange(slot.startTime, slot.endTime)}`,
        detail: range,
      })
    }

    // The teacher of this course is already somewhere else.
    if (course.teacherId && slot.course.teacherId === course.teacherId) {
      conflicts.push({
        kind: 'TEACHER',
        slotId: slot.id,
        message: `The teacher of ${course.code} is already taking ${slot.course.code} for ${slot.class.name}`,
        detail: `${timeRange(slot.startTime, slot.endTime)} on ${weekdayLabel(input.dayOfWeek)}`,
      })
    }

    // Two classes cannot share a room.
    if (slot.room.trim().toLowerCase() === input.room.trim().toLowerCase()) {
      conflicts.push({
        kind: 'ROOM',
        slotId: slot.id,
        message: `${slot.room} is already booked by ${slot.course.code} (${slot.class.name})`,
        detail: `${timeRange(slot.startTime, slot.endTime)} on ${weekdayLabel(input.dayOfWeek)}`,
      })
    }
  }

  return conflicts
}

/** One sentence for the API response — the first conflict usually explains it. */
export function conflictSummary(conflicts: SlotConflict[]): string {
  return conflicts[0]?.message ?? 'Slot conflicts with an existing entry'
}

// ── Week grid ───────────────────────────────────────────────────────────────

export interface GridSlot {
  id: string
  courseId: string
  courseCode: string
  courseName: string
  teacherName: string | null
  className: string
  room: string
  startTime: string
  endTime: string
  dayOfWeek: number
}

export interface WeekGrid {
  /** Earliest start across all slots, snapped down to the hour. */
  fromHour: number
  /** Latest end, snapped up to the hour. */
  toHour: number
  hours: number[]
  days: typeof WEEKDAYS
  slots: GridSlot[]
}

const DEFAULT_FROM = 8
const DEFAULT_TO = 18

/**
 * Derive the visible time window from the data itself, so a college that starts
 * at 07:00 or runs late labs isn't forced into somebody else's 9–5 grid.
 */
export function buildWeekGrid(slots: GridSlot[]): WeekGrid {
  if (slots.length === 0) {
    return {
      fromHour: DEFAULT_FROM,
      toHour: DEFAULT_TO,
      hours: hoursBetween(DEFAULT_FROM, DEFAULT_TO),
      days: WEEKDAYS,
      slots,
    }
  }

  const fromHour = Math.min(...slots.map((s) => Math.floor(toMinutes(s.startTime) / 60)))
  const toHour = Math.max(...slots.map((s) => Math.ceil(toMinutes(s.endTime) / 60)))

  return {
    fromHour,
    toHour,
    hours: hoursBetween(fromHour, toHour),
    days: WEEKDAYS,
    slots,
  }
}

function hoursBetween(from: number, to: number): number[] {
  const out: number[] = []
  for (let h = from; h < to; h += 1) out.push(h)
  return out
}

/** Top offset and height in grid-row units (1 unit = 1 minute) for CSS grid. */
export function slotPlacement(slot: GridSlot, fromHour: number): { top: number; height: number } {
  const start = toMinutes(slot.startTime) - fromHour * 60
  return { top: start, height: Math.max(durationMinutes(slot.startTime, slot.endTime), 30) }
}
