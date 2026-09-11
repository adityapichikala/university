/**
 * Shared academic constants and pure helpers.
 * Kept out of lib/roles.ts so it stays importable from client components
 * (no Prisma / server-only imports in here).
 */

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value)
}

/** Only PRESENT and LATE count toward attendance percentage. */
export const CREDITED_STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE']

export const ATTENDANCE_COLOR: Record<AttendanceStatus, string> = {
  PRESENT: 'text-success',
  ABSENT: 'text-danger',
  LATE: 'text-warning',
  EXCUSED: 'text-muted',
}

export const EXAM_TYPES = ['INTERNAL', 'MIDTERM', 'ENDTERM', 'QUIZ', 'PRACTICAL'] as const
export type ExamType = (typeof EXAM_TYPES)[number]

export function isExamType(value: unknown): value is ExamType {
  return typeof value === 'string' && (EXAM_TYPES as readonly string[]).includes(value)
}

/**
 * Letter grade from a percentage. The cut-offs live here so the API and the UI
 * can never disagree about what a score means.
 */
export function gradeFromPercentage(percentage: number): string {
  if (percentage >= 90) return 'O'
  if (percentage >= 80) return 'A+'
  if (percentage >= 70) return 'A'
  if (percentage >= 60) return 'B+'
  if (percentage >= 50) return 'B'
  if (percentage >= 40) return 'C'
  return 'F'
}

/**
 * Parse a "YYYY-MM-DD" string into a UTC-midnight Date.
 *
 * Critical: Attendance has @@unique([studentId, courseId, date]), so an
 * inconsistent time component would defeat the constraint and let the same
 * student be marked twice for one day. Everything must be stored at midnight UTC.
 */
export function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Format a Date back to "YYYY-MM-DD" (UTC), for URLs and form defaults. */
export function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/* ── Assignments & submissions (Wave 3) ────────────────────────────────────── */

export const SUBMISSION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'LATE',
  'GRADED',
  'RETURNED',
] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === 'string' && (SUBMISSION_STATUSES as readonly string[]).includes(value)
}

/**
 * A submission is late when it lands after the assignment's due date.
 * Computed on write (and stored as the `status`) so "was it late?" is a fact
 * in the database rather than something re-derived from a possibly-edited
 * due date later on.
 */
export function submissionStatusFor(dueDate: Date, submittedAt: Date): SubmissionStatus {
  return submittedAt.getTime() > dueDate.getTime() ? 'LATE' : 'SUBMITTED'
}

/**
 * Grade a submission: clamp to [0, maxMarks] and derive the letter grade.
 * Returns null when maxMarks is not positive, so callers can reject instead
 * of dividing by zero.
 */
export function scoreSummary(score: number, maxMarks: number) {
  if (maxMarks <= 0) return null
  const clamped = Math.min(Math.max(score, 0), maxMarks)
  const percentage = (clamped / maxMarks) * 100
  return {
    score: clamped,
    percentage: Math.round(percentage * 10) / 10,
    letter: gradeFromPercentage(percentage),
  }
}
