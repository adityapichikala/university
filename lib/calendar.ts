/**
 * Academic calendar vocabulary and date maths.
 *
 * Pure functions only — no Prisma, no React — so the full-month calendar, the
 * student dashboard strip and the seed can all derive the same answer from the
 * same inputs. Everything is UTC-midnight to keep a date a date: a holiday on
 * the 15th must not slide to the 14th for a user east of the server.
 */

export const CALENDAR_DAY_KINDS = ['HOLIDAY', 'CLOSURE', 'BREAK', 'EVENT'] as const

export type CalendarDayKind = (typeof CALENDAR_DAY_KINDS)[number]

export function isCalendarDayKind(value: unknown): value is CalendarDayKind {
  return typeof value === 'string' && (CALENDAR_DAY_KINDS as readonly string[]).includes(value)
}

export const CALENDAR_DAY_LABEL: Record<CalendarDayKind, string> = {
  HOLIDAY: 'Holiday',
  CLOSURE: 'Closure',
  BREAK: 'Break',
  EVENT: 'Event',
}

export const CALENDAR_DAY_ICON: Record<CalendarDayKind, string> = {
  HOLIDAY: 'celebration',
  CLOSURE: 'block',
  BREAK: 'beach_access',
  EVENT: 'campaign',
}

/**
 * Badge tone per event family. The three families the calendar distinguishes
 * are lectures (a class to attend), exams (assessment) and non-teaching days
 * (nothing to attend).
 */
export const EVENT_TONE = {
  LECTURE: 'bg-accent-soft text-accent',
  EXAM: 'bg-danger-soft text-danger',
  HOLIDAY: 'bg-success-soft text-success',
  CLOSURE: 'bg-background text-subtle',
  EVENT: 'bg-warning-soft text-warning',
} as const

export type CalendarEventKind = 'LECTURE' | 'EXAM' | 'HOLIDAY' | 'CLOSURE' | 'EVENT'

/** UTC-midnight key, "YYYY-MM-DD". The canonical identity of a calendar day. */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Parse a UTC-midnight date from "YYYY-MM-DD", or null if malformed. */
export function parseDateKey(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Midnight UTC today — the anchor every month calculation starts from. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime())
  // Set day to 1 first so 31 Jan + 1 month does not overflow into March.
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + months)
  return next
}

export function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

export function endOfMonthUtc(date: Date): Date {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
}

export function startOfWeekUtc(date: Date): Date {
  // ISO weeks start Monday. getUTCDay(): 0=Sun…6=Sat.
  const day = date.getUTCDay()
  const shift = day === 0 ? -6 : 1 - day
  return addDays(date, shift)
}

export function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b)
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0
}

/**
 * The 6×7 grid a month view shows: whole ISO weeks, including the leading and
 * trailing days that belong to the adjacent months.
 *
 * Always 42 cells so the grid never jumps height between months — a calendar
 * that reflows when you page through it is harder to scan than one that does
 * not, even if a few cells repeat the neighbours.
 */
export function monthMatrix(month: Date): Date[] {
  const first = startOfMonthUtc(month)
  const gridStart = startOfWeekUtc(first)
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}

/** The 7 day-columns for a week view, Monday first. */
export function weekDays(anchor: Date): Date[] {
  const start = startOfWeekUtc(anchor)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export function monthLabel(month: Date): string {
  return month.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function dayLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function shortDayLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** "Mon", "Tue" … derived from the same UTC clock the grid uses. */
export function weekdayShort(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
}

/**
 * Which columns a month view should render. Sunday is dropped because the
 * schema's teaching week is Mon–Sat; showing an always-empty column wastes a
 * seventh of the width on a phone.
 */
export function monthViewDays(): string[] {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
}

/** Schema day-of-week (0=Sun…6=Sat) from a UTC date. */
export function schemaDayOfWeek(date: Date): number {
  return date.getUTCDay()
}
