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
          course: { select: { id: true, code: true, name: true, credits: true } },
        },
      },
    },
    orderBy: { exam: { examDate: 'desc' } },
  })

  // Group per course. The schema has no exam weightings, so a course's
  // published exams are averaged — see lib/grading.ts for the caveat.
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

  const courses: CourseTranscriptRow[] = [...byCourse.entries()]
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

  const totals: CgpaResult = computeCgpa(courses)

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
  }
}
