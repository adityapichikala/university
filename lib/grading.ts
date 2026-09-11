import { gradeFromPercentage } from '@/lib/academics'

/**
 * Grading scale and CGPA (Phase 2).
 *
 * The letter cut-offs live in `gradeFromPercentage()` in lib/academics.ts so
 * every screen agrees on what a score means. This file adds the second half:
 * grade POINTS, and the credit weighting that turns them into a CGPA.
 */

/**
 * 10-point scale matching the letters produced by `gradeFromPercentage`.
 * A failed course is worth 0 points but its credits still count in the
 * denominator — the conservative reading, and the one that stops a student
 * from raising their CGPA by failing a course.
 */
export const GRADE_POINTS: Record<string, number> = {
  O: 10,
  'A+': 9,
  A: 8,
  'B+': 7,
  B: 6,
  C: 5,
  F: 0,
}

/** Letters that earn credit. `F` is the only failing grade in this scale. */
const PASSING = new Set(['O', 'A+', 'A', 'B+', 'B', 'C'])

export function gradePointFor(letter: string): number {
  return GRADE_POINTS[letter] ?? 0
}

export function isPassingGrade(letter: string): boolean {
  return PASSING.has(letter)
}

export interface CourseCredit {
  credits: number
  gradePoint: number
  letter: string
}

export interface CgpaResult {
  /** Sum of credits × grade points. */
  weightedPoints: number
  /** Credits counted in the denominator. */
  attemptedCredits: number
  /** Credits attached to a passing grade. */
  earnedCredits: number
  cgpa: number
}

/**
 * Credit-weighted average: Σ(credits × points) / Σ(credits).
 *
 * Returns zeros rather than NaN when there is nothing to average, so callers
 * can render `0.0` without special-casing an empty transcript.
 */
export function computeCgpa(courses: CourseCredit[]): CgpaResult {
  let weightedPoints = 0
  let attemptedCredits = 0
  let earnedCredits = 0

  for (const course of courses) {
    const credits = Math.max(course.credits, 0)
    weightedPoints += credits * course.gradePoint
    attemptedCredits += credits
    if (isPassingGrade(course.letter)) earnedCredits += credits
  }

  return {
    weightedPoints: round2(weightedPoints),
    attemptedCredits,
    earnedCredits,
    cgpa: attemptedCredits === 0 ? 0 : round2(weightedPoints / attemptedCredits),
  }
}

/**
 * Letter for a set of exam percentages on one course.
 *
 * The schema has no exam weightings, so a course's marks are averaged and the
 * average is mapped to a letter. That is a defensible default, not official
 * policy — surfaced in the UI copy so nobody mistakes it for one.
 */
export function letterForCoursePercentages(percentages: number[]): string {
  if (percentages.length === 0) return 'F'
  const mean = percentages.reduce((sum, p) => sum + p, 0) / percentages.length
  return gradeFromPercentage(mean)
}

export function percentage(marksObtained: number, maxMarks: number): number {
  if (maxMarks <= 0) return 0
  return round2((marksObtained / maxMarks) * 100)
}

/** One decimal place, as a CGPA is conventionally shown (e.g. 8.4). */
export function formatCgpa(value: number): string {
  return value.toFixed(1)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
