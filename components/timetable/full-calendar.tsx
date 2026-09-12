'use client'

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'
import { cn } from '@/lib/utils'
import {
  CALENDAR_DAY_ICON,
  CALENDAR_DAY_LABEL,
  EVENT_TONE,
  addDays,
  addMonths,
  dateKey,
  dayLabel,
  isCalendarDayKind,
  isSameDay,
  monthLabel,
  monthMatrix,
  monthViewDays,
  shortDayLabel,
  startOfMonthUtc,
  todayUtc,
  weekDays,
  weekdayShort,
  type CalendarEventKind,
} from '@/lib/calendar'

/**
 * Full-month interactive calendar, shared by the student screen.
 *
 * Three views over one dataset: month (6×7 grid), week (one column per day)
 * and day (an agenda list). They are views, not separate components, because
 * switching between them must not lose the anchor date — paging to March in
 * month view and switching to week lands on March, not back on today.
 *
 * The component is presentational: it receives already-resolved events and
 * does no fetching, so the server component owns the query and the timezone.
 * All dates are UTC-midnight; see `lib/calendar.ts`.
 */

export type CalendarView = 'month' | 'week' | 'day'

export interface CalendarEvent {
  id: string
  /** UTC-midnight "YYYY-MM-DD". */
  date: string
  kind: CalendarEventKind
  title: string
  /** e.g. "09:00–10:00", or null for an all-day entry. */
  time: string | null
  subtitle: string | null
}

const VIEWS: { value: CalendarView; label: string; icon: string }[] = [
  { value: 'month', label: 'Month', icon: 'calendar_view_month' },
  { value: 'week', label: 'Week', icon: 'calendar_view_week' },
  { value: 'day', label: 'Day', icon: 'today' },
]

export function FullCalendar({ events }: { events: CalendarEvent[] }) {
  const today = React.useMemo(() => todayUtc(), [])
  const [view, setView] = React.useState<CalendarView>('month')
  const [anchor, setAnchor] = React.useState<Date>(() => todayUtc())

  // Group once per events change — month view reads it 42 times per render.
  const dayIndex = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const list = map.get(event.date)
      if (list) list.push(event)
      else map.set(event.date, [event])
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title))
    }
    return map
  }, [events])

  function eventsOn(date: Date): CalendarEvent[] {
    return dayIndex.get(dateKey(date)) ?? []
  }

  function step(direction: -1 | 1) {
    setAnchor((current) =>
      view === 'month'
        ? addMonths(current, direction)
        : view === 'week'
          ? addDays(current, direction * 7)
          : addDays(current, direction)
    )
  }

  const heading =
    view === 'month'
      ? monthLabel(anchor)
      : view === 'week'
        ? `${shortDayLabel(weekDays(anchor)[0])} – ${shortDayLabel(weekDays(anchor)[6])}`
        : dayLabel(anchor)

  const counts = React.useMemo(() => {
    let lectures = 0
    let exams = 0
    let days = 0
    for (const event of events) {
      if (event.kind === 'LECTURE') lectures += 1
      else if (event.kind === 'EXAM') exams += 1
      else days += 1
    }
    return { lectures, exams, days }
  }, [events])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous"
              onClick={() => step(-1)}
            >
              <span className="material-symbols-outlined text-[20px] leading-none">
                chevron_left
              </span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next"
              onClick={() => step(1)}
            >
              <span className="material-symbols-outlined text-[20px] leading-none">
                chevron_right
              </span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAnchor(todayUtc())}>
              Today
            </Button>
            <h2 className="font-heading text-base font-semibold text-foreground">{heading}</h2>
          </div>

          <div
            role="tablist"
            aria-label="Calendar view"
            className="inline-flex rounded-xl border border-border bg-background p-0.5"
          >
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={view === v.value}
                onClick={() => setView(v.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-medium transition-colors',
                  view === v.value
                    ? 'bg-surface text-foreground shadow-soft'
                    : 'text-muted hover:text-foreground'
                )}
              >
                <span className="material-symbols-outlined text-[16px] leading-none">
                  {v.icon}
                </span>
                <span className="hidden sm:inline">{v.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', EVENT_TONE.LECTURE.split(' ')[0])} />
            {counts.lectures} lecture{counts.lectures === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', EVENT_TONE.EXAM.split(' ')[0])} />
            {counts.exams} exam{counts.exams === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', EVENT_TONE.HOLIDAY.split(' ')[0])} />
            {counts.days} holiday{counts.days === 1 ? '' : 's'}/event{counts.days === 1 ? '' : 's'}
          </span>
        </div>
      </Card>

      {view === 'month' ? (
        <MonthView anchor={anchor} today={today} eventsOn={eventsOn} onPickDay={(d) => { setAnchor(d); setView('day') }} />
      ) : view === 'week' ? (
        <WeekView anchor={anchor} today={today} eventsOn={eventsOn} onPickDay={(d) => { setAnchor(d); setView('day') }} />
      ) : (
        <DayView anchor={anchor} eventsOn={eventsOn} />
      )}
    </div>
  )
}

// ── Month ───────────────────────────────────────────────────────────────────

function MonthView({
  anchor,
  today,
  eventsOn,
  onPickDay,
}: {
  anchor: Date
  today: Date
  eventsOn: (date: Date) => CalendarEvent[]
  onPickDay: (date: Date) => void
}) {
  // Sunday is dropped: the schema's teaching week is Mon–Sat, so the seventh
  // column would always be empty and would eat a seventh of a phone's width.
  const columns = monthViewDays() // Mon…Sat
  const cells = monthMatrix(anchor).filter((d) => d.getUTCDay() !== 0)
  const month = startOfMonthUtc(anchor).getUTCMonth()

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-6 border-b border-border bg-background">
        {columns.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted"
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.slice(0, 1)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-6">
        {cells.map((date) => {
          const dayEvents = eventsOn(date)
          const outside = date.getUTCMonth() !== month
          const isToday = isSameDay(date, today)
          // Month cells show at most 2 chips; the rest collapse into "+N".
          const shown = dayEvents.slice(0, 2)
          const overflow = dayEvents.length - shown.length

          return (
            <button
              key={dateKey(date)}
              type="button"
              onClick={() => onPickDay(date)}
              className={cn(
                'group relative flex min-h-[76px] flex-col gap-1 border-b border-r border-border p-1.5 text-left transition-colors sm:min-h-[104px] sm:p-2',
                'last:border-r-0 hover:bg-accent-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
                outside && 'bg-background/60'
              )}
            >
              <span
                className={cn(
                  'num inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                  isToday
                    ? 'bg-accent text-white'
                    : outside
                      ? 'text-subtle'
                      : 'text-foreground'
                )}
              >
                {date.getUTCDate()}
              </span>

              <div className="flex flex-col gap-0.5">
                {shown.map((event) => (
                  <span
                    key={event.id}
                    className={cn(
                      'truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight',
                      EVENT_TONE[event.kind]
                    )}
                    title={`${event.title}${event.time ? ` · ${event.time}` : ''}`}
                  >
                    {event.title}
                  </span>
                ))}
                {overflow > 0 ? (
                  <span className="px-1 text-[10px] text-subtle">+{overflow} more</span>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

// ── Week ────────────────────────────────────────────────────────────────────

function WeekView({
  anchor,
  today,
  eventsOn,
  onPickDay,
}: {
  anchor: Date
  today: Date
  eventsOn: (date: Date) => CalendarEvent[]
  onPickDay: (date: Date) => void
}) {
  const days = weekDays(anchor).filter((d) => d.getUTCDay() !== 0)

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      {days.map((date) => {
        const dayEvents = eventsOn(date)
        const isToday = isSameDay(date, today)
        return (
          <Card
            key={dateKey(date)}
            className={cn('flex flex-col p-3', isToday && 'ring-2 ring-accent/40')}
          >
            <button
              type="button"
              onClick={() => onPickDay(date)}
              className="mb-2 flex items-baseline justify-between text-left"
            >
              <span className="text-xs font-semibold text-muted">{weekdayShort(date)}</span>
              <span
                className={cn(
                  'num text-sm font-semibold',
                  isToday ? 'text-accent' : 'text-foreground'
                )}
              >
                {date.getUTCDate()}
              </span>
            </button>

            {dayEvents.length === 0 ? (
              <p className="text-[11px] text-subtle">No classes</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {dayEvents.map((event) => (
                  <div
                    key={event.id}
                    className={cn('rounded-lg px-2 py-1.5 text-[11px] leading-tight', EVENT_TONE[event.kind])}
                  >
                    <p className="truncate font-semibold">{event.title}</p>
                    {event.time ? <p className="num mt-0.5 opacity-80">{event.time}</p> : null}
                    {event.subtitle ? (
                      <p className="mt-0.5 truncate opacity-70">{event.subtitle}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ── Day ─────────────────────────────────────────────────────────────────────

function DayView({
  anchor,
  eventsOn,
}: {
  anchor: Date
  eventsOn: (date: Date) => CalendarEvent[]
}) {
  const dayEvents = eventsOn(anchor)

  if (dayEvents.length === 0) {
    return (
      <EmptyState
        icon="event_available"
        title="Nothing on this day"
        description={`No classes, exams or holidays recorded for ${dayLabel(anchor)}.`}
      />
    )
  }

  return (
    <div className="space-y-2">
      {dayEvents.map((event) => (
        <Card key={event.id} className="flex items-start gap-3 p-4">
          <span
            className={cn(
              'material-symbols-outlined mt-0.5 shrink-0 rounded-lg p-1.5 text-[18px] leading-none',
              EVENT_TONE[event.kind]
            )}
          >
            {event.kind === 'LECTURE'
              ? 'menu_book'
              : event.kind === 'EXAM'
                ? 'quiz'
                : CALENDAR_DAY_ICON[event.kind as Exclude<CalendarEventKind, 'LECTURE' | 'EXAM'>] ??
                  'event'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-sm font-semibold text-foreground">{event.title}</p>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  EVENT_TONE[event.kind]
                )}
              >
                {event.kind === 'LECTURE'
                  ? 'Lecture'
                  : event.kind === 'EXAM'
                    ? 'Exam'
                    : isCalendarDayKind(event.kind)
                      ? CALENDAR_DAY_LABEL[event.kind]
                      : event.kind}
              </span>
            </div>
            {event.time ? (
              <p className="num mt-1 text-xs text-muted">{event.time}</p>
            ) : (
              <p className="mt-1 text-xs text-subtle">All day</p>
            )}
            {event.subtitle ? (
              <p className="mt-1 text-xs text-muted">{event.subtitle}</p>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  )
}
