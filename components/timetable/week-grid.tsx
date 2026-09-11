'use client'

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { cn } from '@/lib/utils'
import {
  WEEKDAYS,
  buildWeekGrid,
  slotPlacement,
  timeRange,
  type GridSlot,
} from '@/lib/timetable'

/**
 * Week-at-a-glance timetable grid, shared by the student (read-only) and
 * teacher (click to edit) screens.
 *
 * One vertical pixel = one minute, so a 45-minute lab and a three-hour
 * practical both land in the right place with no magic numbers. Columns are
 * positioned by percentage so the grid stays fluid without CSS grid gymnastics.
 */

const PX_PER_MINUTE = 1
const GUTTER_W = 56
const HEADER_H = 38
const COL = 100 / WEEKDAYS.length

export function WeekGrid({
  slots,
  today,
  emptyTitle,
  emptyHint,
  selectedId,
  onSlotClick,
}: {
  slots: GridSlot[]
  /** 1 = Monday … 6 = Saturday. Highlights the current column. */
  today: number
  emptyTitle?: string
  emptyHint?: string
  selectedId?: string | null
  onSlotClick?: (slot: GridSlot) => void
}) {
  const grid = buildWeekGrid(slots)
  const height = (grid.toHour - grid.fromHour) * 60 * PX_PER_MINUTE

  if (slots.length === 0) {
    return (
      <EmptyState
        icon="calendar_month"
        title={emptyTitle ?? 'No classes scheduled'}
        description={emptyHint ?? 'Slots will appear here once they are added to your timetable.'}
      />
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="flex border-b border-border bg-background">
            <div className="shrink-0" style={{ width: GUTTER_W, height: HEADER_H }} />
            {WEEKDAYS.map((day) => (
              <div
                key={day.value}
                className={cn(
                  'flex items-center justify-center border-l border-border',
                  day.value === today && 'bg-accent-soft'
                )}
                style={{ width: `${COL}%`, height: HEADER_H }}
              >
                <span
                  className={cn(
                    'num text-xs font-semibold',
                    day.value === today ? 'text-accent' : 'text-muted'
                  )}
                >
                  {day.short}
                </span>
              </div>
            ))}
          </div>

          <div className="flex">
            <div className="relative shrink-0" style={{ width: GUTTER_W, height }}>
              {grid.hours.map((hour) => (
                <span
                  key={hour}
                  className="num absolute right-2 -translate-y-1/2 text-[11px] text-subtle"
                  style={{ top: (hour - grid.fromHour) * 60 * PX_PER_MINUTE }}
                >
                  {String(hour).padStart(2, '0')}:00
                </span>
              ))}
            </div>

            <div className="relative flex-1" style={{ height }}>
              {grid.hours.map((hour) => (
                <div
                  key={hour}
                  aria-hidden
                  className="absolute inset-x-0 border-t border-border"
                  style={{ top: (hour - grid.fromHour) * 60 * PX_PER_MINUTE }}
                />
              ))}

              {WEEKDAYS.map((day, index) => (
                <div
                  key={day.value}
                  aria-hidden
                  className={cn(
                    'absolute inset-y-0 border-l border-border',
                    day.value === today && 'bg-accent-soft/40'
                  )}
                  style={{ left: `${index * COL}%`, width: `${COL}%` }}
                />
              ))}

              {slots.map((slot) => {
                const { top, height: slotHeight } = slotPlacement(slot, grid.fromHour)
                const index = WEEKDAYS.findIndex((d) => d.value === slot.dayOfWeek)
                const selected = selectedId === slot.id
                const interactive = Boolean(onSlotClick)

                return (
                  <div
                    key={slot.id}
                    role={interactive ? 'button' : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    onClick={interactive ? () => onSlotClick?.(slot) : undefined}
                    onKeyDown={
                      interactive
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onSlotClick?.(slot)
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      'absolute overflow-hidden rounded-lg border-l-2 border-accent px-2 py-1',
                      selected ? 'bg-accent ring-2 ring-accent/30' : 'bg-accent-soft',
                      interactive && 'cursor-pointer transition-transform hover:scale-[1.02]'
                    )}
                    style={{
                      top: top * PX_PER_MINUTE + 2,
                      height: Math.max(slotHeight * PX_PER_MINUTE - 4, 22),
                      left: `calc(${index * COL}% + 4px)`,
                      width: `calc(${COL}% - 8px)`,
                    }}
                    title={`${slot.courseName} · ${timeRange(slot.startTime, slot.endTime)} · ${slot.room}`}
                  >
                    <p
                      className={cn(
                        'num truncate text-[11px] font-semibold',
                        selected ? 'text-white' : 'text-accent'
                      )}
                    >
                      {slot.courseCode}
                    </p>
                    <p
                      className={cn(
                        'num truncate text-[10px]',
                        selected ? 'text-white/80' : 'text-muted'
                      )}
                    >
                      {timeRange(slot.startTime, slot.endTime)}
                    </p>
                    {slotHeight >= 60 ? (
                      <p
                        className={cn(
                          'num truncate text-[10px]',
                          selected ? 'text-white/70' : 'text-subtle'
                        )}
                      >
                        {slot.room}
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
