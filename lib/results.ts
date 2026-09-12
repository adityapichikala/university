import type { PrismaClient } from '@prisma/client'
import type { AuthContext } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import {
  computeCgpa,
  formatCgpa,
  gradePointFor,
  isPassingGrade,
  letterForCoursePercentages,
  percentage,
  type CgpaResult,
} from '@/lib/grading'

/**
 * Transcript assembly (Phase 2).
 *
 * `lib/grading.ts` is pure arithmetic; this file is the half that talks to the
 * database. Keeping them apart means the CGPA maths can be unit-tested without
 * a database at all.
 */

export interface CourseTranscriptRow {
  courseId: string
  courseCode: string
  courseName: string
  credits: number
  /** How many published exams were averaged for this course. */
  examCount: number
  averagePercentage: number
  letter: string
  gradePoint: number
  /** credits × gradePoint — this course's contribution to the total. */
  weighted: number
  passing: boolean
}

export interface TranscriptRow {
  id: string
  marksObtained: number
  maxMarks: number
  percent: number
  grade: string
  examType: string
  examDate: string
  publishedAt: string
}

export interface Transcript {
  studentId: string
  studentRegno: string
  studentName: string
  courses: CourseTranscriptRow[]
  results: TranscriptRow[]
  cgpa: number
  cgpaDisplay: string
  attemptedCredits: number
  earnedCredits: number
  weightedPoints: number
  publishedResultCount: number
  /**
   * Credit-weighted GPA per semester, oldest first.
   *
   * The overall CGPA is not stored separately from these: it is exactly the
   * credit-weighted mean of them, because Σ(credits × points) and Σ(credits)
   * both distribute over the semester partition. Computing it once over all
   * courses and once per semester therefore cannot disagree.
   */
  semesters: SemesterTranscript[]
}

export interface SemesterTranscript {
  /** Null when a result's exam is not linked to a semester record. */
  semesterId: string | null
  semesterName: string
  semesterNumber: number | null
  /** Distinct courses graded in this semester. */
  courseCount: number
  attemptedCredits: number
  earnedCredits: number
  weightedPoints: number
  /** Credit-weighted GPA for this semester alone (an "SGPA"). */
  gpa: number
  gpaDisplay: string
}

/** Bucket key for results whose exam is not linked to a semester record. */
const UNASSIGNED_SEMESTER = '__unassigned__'

/**
 * Collapse a set of published results into one row per course.
 *
 * The schema has no exam weightings, so a course's published exams are
 * averaged — see lib/grading.ts for that caveat. It takes a *subset* so the
 * same logic serves both the whole transcript and a single semester; anything
 * that differs between the two would make the semester GPAs fail to reconcile
 * with the overall CGPA.
 */
function courseRowsFrom(
  results: {
    marksObtained: number
    exam: { maxMarks: number; course: { id: string; code: string; name: string; credits: number } }
  }[]
): CourseTranscriptRow[] {
  const byCourse = new Map<
    string,
    { code: string; name: string; credits: number; percentages: number[] }
  >()

  for (const r of results) {
    const course = r.exam.course
    const entry =
      byCourse.get(course.id) ??
      { code: course.code, name: course.name, credits: course.credits, percentages: [] }
    entry.percentages.push(percentage(r.marksObtained, r.exam.maxMarks))
    byCourse.set(course.id, entry)
  }

  return [...byCourse.entries()]
    .map(([courseId, entry]) => {
      const letter = letterForCoursePercentages(entry.percentages)
      const gradePoint = gradePointFor(letter)
      const credits = Math.max(entry.credits, 0)
      const mean =
        entry.percentages.reduce((sum, p) => sum + p, 0) / Math.max(entry.percentages.length, 1)
      return {
        courseId,
        courseCode: entry.code,
        courseName: entry.name,
        credits,
        examCount: entry.percentages.length,
        averagePercentage: Math.round(mean * 10) / 10,
        letter,
        gradePoint,
        weighted: Math.round(credits * gradePoint * 100) / 100,
        passing: isPassingGrade(letter),
      }
    })
    .sort((a, b) => a.courseCode.localeCompare(b.courseCode))
}

/**
 * Who may read a transcript.
 *
 * Tier 2: results.read / user.manage opens it up broadly.
 * Tier 3: a teacher may only see students who are enrolled in a course they
 * actually teach — being a teacher is not a licence to read every student.
 */
export async function canViewTranscript(
  prisma: PrismaClient,
  ctx: AuthContext,
  studentId: string
): Promise<boolean> {
  if (ctx.user.id === studentId) return true

  const broad = ctx.can(PERMISSIONS.USER_MANAGE) || ctx.can(PERMISSIONS.GRADE_ENTRY)
  if (broad && ctx.user.role !== 'TEACHER') return true

  if (ctx.user.role === 'TEACHER') {
    const enrolled = await prisma.courseEnrollment.findFirst({
      where: {
        studentId,
        ...(ctx.user.collegeId ? { collegeId: ctx.user.collegeId } : {}),
        course: { teacherId: ctx.user.id },
      },
      select: { id: true },
    })
    return Boolean(enrolled)
  }

  return false
}

/**
 * Build the credit-weighted transcript for one student.
 *
 * Only PUBLISHED results count — an unpublished mark is invisible here for the
 * same reason it is invisible on the student's results page.
 */
export async function buildTranscript(
  prisma: PrismaClient,
  studentId: string,
  collegeId: string | null
): Promise<Transcript | null> {
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { id: true, regno: true, name: true },
  })
  if (!student) return null

  const results = await prisma.examResult.findMany({
    where: {
      studentId,
      ...(collegeId ? { collegeId } : {}),
      publishedAt: { not: null },
    },
    select: {
      id: true,
      marksObtained: true,
      grade: true,
      publishedAt: true,
      exam: {
        select: {
          id: true,
          examType: true,
          examDate: true,
          maxMarks: true,
          semesterId: true,
          semester: { select: { id: true, number: true, name: true } },
          course: { select: { id: true, code: true, name: true, credits: true } },
        },
      },
    },
    orderBy: { exam: { examDate: 'desc' } },
  })

  // Grouping runs twice — once over every result (the overall CGPA) and once
  // per semester (the SGPA). Both go through the same helper, so a course can
  // never be graded one way in the breakdown and another way in a semester row.
  const courses = courseRowsFrom(results)
  const totals: CgpaResult = computeCgpa(courses)

  // ── Per-semester split ───────────────────────────────────────────────────
  // Results whose exam carries no semester record still get a bucket, so
  // credits never silently vanish from the semester table.
  const bySemester = new Map<string, typeof results>()
  for (const r of results) {
    const key = r.exam.semesterId ?? UNASSIGNED_SEMESTER
    const list = bySemester.get(key)
    if (list) list.push(r)
    else bySemester.set(key, [r])
  }

  const semesters: SemesterTranscript[] = [...bySemester.entries()]
    .map(([key, rows]) => {
      const semesterCourses = courseRowsFrom(rows)
      const semesterTotals = computeCgpa(semesterCourses)
      const meta = rows[0]?.exam.semester ?? null
      return {
        semesterId: key === UNASSIGNED_SEMESTER ? null : key,
        semesterName: meta?.name ?? 'Unassigned',
        semesterNumber: meta?.number ?? null,
        courseCount: semesterCourses.length,
        attemptedCredits: semesterTotals.attemptedCredits,
        earnedCredits: semesterTotals.earnedCredits,
        weightedPoints: semesterTotals.weightedPoints,
        gpa: semesterTotals.cgpa,
        gpaDisplay: formatCgpa(semesterTotals.cgpa),
      }
    })
    .sort((a, b) => {
      // Numbered semesters in order; anything unassigned sorts last.
      if (a.semesterNumber === null) return b.semesterNumber === null ? 0 : 1
      if (b.semesterNumber === null) return -1
      return a.semesterNumber - b.semesterNumber
    })

  return {
    studentId: student.id,
    studentRegno: student.regno,
    studentName: student.name,
    courses,
    results: results.map((r) => ({
      id: r.id,
      marksObtained: r.marksObtained,
      maxMarks: r.exam.maxMarks,
      percent: percentage(r.marksObtained, r.exam.maxMarks),
      grade: r.grade,
      examType: r.exam.examType,
      examDate: r.exam.examDate.toISOString(),
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : '',
    })),
    cgpa: totals.cgpa,
    cgpaDisplay: formatCgpa(totals.cgpa),
    attemptedCredits: totals.attemptedCredits,
    earnedCredits: totals.earnedCredits,
    weightedPoints: totals.weightedPoints,
    publishedResultCount: results.length,
    semesters,
  }
}
