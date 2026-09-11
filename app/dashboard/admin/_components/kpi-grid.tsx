import { prisma } from '@/lib/db'
import { cn } from '@/lib/utils'

/**
 * Bento KPI row. Four numbers, one glance — the top of the governance page.
 * All numerals use JetBrains Mono (`num`) per the design system.
 */

interface KpiProps {
  label: string
  value: number
  icon: string
  hint: string
  /** Tailwind column span inside the 6-col bento. */
  span: string
  /** Optional 0–1 fill bar. */
  progress?: number
  progressLabel?: string
  tone?: 'accent' | 'success' | 'warning' | 'neutral'
}

const TONE: Record<NonNullable<KpiProps['tone']>, string> = {
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  neutral: 'bg-background text-muted',
}

function KpiCard({ label, value, icon, hint, span, progress, progressLabel, tone = 'accent' }: KpiProps) {
  return (
    <article
      className={cn(
        'group rounded-xl border border-border bg-surface p-5 shadow-soft',
        'transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift',
        span
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
          <p className="num mt-2 text-3xl font-bold leading-none tracking-tight text-primary">
            {value.toLocaleString('en-US')}
          </p>
        </div>
        <span
          className={cn(
            'material-symbols-outlined shrink-0 rounded-xl p-2.5 text-[20px] leading-none transition-transform duration-200 group-hover:scale-105',
            TONE[tone]
          )}
        >
          {icon}
        </span>
      </div>

      {progress !== undefined ? (
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
          </div>
          {progressLabel ? (
            <p className="num mt-1.5 text-[10px] text-subtle">{progressLabel}</p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-muted">{hint}</p>
    </article>
  )
}

export async function KpiPanel({ collegeId }: { collegeId: string | null }) {
  const where = collegeId ? { collegeId } : {}

  const [enrollments, enrolledStudents, instructors, activeInstructors, cohorts, denials, lockedSections] =
    await Promise.all([
      prisma.courseEnrollment.count({ where }),
      prisma.courseEnrollment
        .findMany({ where, distinct: ['studentId'], select: { studentId: true } })
        .then((rows) => rows.length),
      prisma.user.count({ where: { ...where, role: 'TEACHER' } }),
      prisma.user.count({ where: { ...where, role: 'TEACHER', status: 'ACTIVE' } }),
      prisma.class.count({ where }),
      prisma.userPermission.count({ where: { granted: false, user: where } }),
      prisma.courseSectionAccess.count({ where: { ...where, enabled: false } }),
    ])

  const restrictions = denials + lockedSections

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <KpiCard
        label="Enrollment count"
        value={enrollments}
        icon="how_to_reg"
        span="sm:col-span-2 lg:col-span-4"
        hint={`${enrolledStudents.toLocaleString('en-US')} students hold at least one course enrollment.`}
        progress={enrolledStudents > 0 ? 1 : 0}
        progressLabel={`${enrolledStudents} enrolled students`}
      />
      <KpiCard
        label="Security restrictions"
        value={restrictions}
        icon="gpp_maybe"
        span="lg:col-span-2"
        tone={restrictions > 0 ? 'warning' : 'success'}
        hint={
          restrictions === 0
            ? 'No explicit denials or locked sections.'
            : `${denials} permission denial${denials === 1 ? '' : 's'} · ${lockedSections} locked section${lockedSections === 1 ? '' : 's'}`
        }
      />
      <KpiCard
        label="Verified instructors"
        value={activeInstructors}
        icon="verified_user"
        span="lg:col-span-3"
        tone="success"
        hint={`${activeInstructors} of ${instructors} instructor accounts are active.`}
      />
      <KpiCard
        label="Cohorts"
        value={cohorts}
        icon="groups"
        span="lg:col-span-3"
        hint="Class sections defined for this college."
      />
    </div>
  )
}
