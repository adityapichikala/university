'use client'

import * as React from 'react'
import { Switch } from '@/components/ui/switch'
import { EmptyState } from '@/components/ui/states'
import { setSectionAccessAction } from '../actions'
import { useOptimisticToggles } from './use-optimistic-toggles'
import type { ClassRow, CourseRow } from './types'

/**
 * Section-level access control (Tier 3, resource scoping).
 *
 * One row per course, one column per class section. Turning a switch off
 * writes a CourseSectionAccess row with enabled=false, which locks that
 * section out of the course — their students stop seeing it and cannot be
 * marked against it.
 */

export function SectionAccess({
  courses,
  classes,
  access,
}: {
  courses: CourseRow[]
  classes: ClassRow[]
  /** `${courseId}:${classId}` → enabled */
  access: Record<string, boolean>
}) {
  const initial = React.useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const course of courses) {
      for (const klass of classes) {
        out[`${course.id}:${klass.id}`] = access[`${course.id}:${klass.id}`] ?? true
      }
    }
    return out
  }, [courses, classes, access])

  const commit = React.useCallback(async (key: string, value: boolean) => {
    const split = key.indexOf(':')
    return setSectionAccessAction({
      courseId: key.slice(0, split),
      classId: key.slice(split + 1),
      enabled: value,
    })
  }, [])

  const { values, pending, toggle } = useOptimisticToggles(initial, commit, {
    on: 'Section access granted',
    off: 'Section locked',
  })

  if (courses.length === 0 || classes.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon="account_tree"
          title={courses.length === 0 ? 'No courses yet' : 'No class sections yet'}
          description="Section-level control needs at least one course and one class section. Create them under Academics first."
        />
      </div>
    )
  }

  const lockedCount = Object.values(values).filter((v) => !v).length

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <p className="text-xs text-muted">
          Sections switched off are locked out of the course immediately.
        </p>
        <p className="num text-xs text-subtle">
          {lockedCount} locked / {courses.length * classes.length} pairs
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-subtle"
              >
                Course
              </th>
              {classes.map((klass) => (
                <th
                  key={klass.id}
                  scope="col"
                  className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-subtle"
                >
                  {klass.name}
                  <span className="num ml-1 text-[9px] font-normal normal-case text-subtle">
                    S{klass.semester}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => {
              const lockedSections = classes.filter(
                (k) => !values[`${course.id}:${k.id}`]
              ).length

              return (
                <tr
                  key={course.id}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-background"
                >
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="num rounded-md bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted">
                        {course.code}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {course.name}
                        </p>
                        <p className="truncate text-[11px] text-subtle">
                          {course.teacherName ?? 'Unassigned'}
                        </p>
                      </div>
                      {lockedSections > 0 ? (
                        <span
                          title={`${lockedSections} section(s) locked`}
                          className="material-symbols-outlined shrink-0 text-[16px] leading-none text-warning"
                        >
                          lock
                        </span>
                      ) : null}
                    </div>
                  </td>

                  {classes.map((klass) => {
                    const key = `${course.id}:${klass.id}`
                    const isPending = Boolean(pending[key])
                    return (
                      <td key={klass.id} className="px-4 py-3.5">
                        <div className="flex justify-center">
                          <Switch
                            checked={values[key] ?? true}
                            loading={isPending}
                            onCheckedChange={(next) =>
                              toggle(key, next, `${course.code} · ${klass.name}`)
                            }
                            aria-label={`${klass.name} access to ${course.code}`}
                          />
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
