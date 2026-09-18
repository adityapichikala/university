import { prisma } from './db'
import { isPassingGrade } from './grading'
import { formatCurrency } from './fees'
import { audit } from './audit'
import type { AuthContext } from './rbac'
import { PERMISSIONS } from './roles'
import type { MutationResult } from './permissions'
import {
  CLEARANCE_DEPARTMENTS,
  CLEARANCE_META,
  canDecideDepartment,
  type ClearanceDepartment,
  type ClearanceStatus,
  type DepartmentClearance,
  type StudentClearanceRow,
} from './clearance-shared'

/**
 * No-Dues clearance (graduating students).
 *
 * Four departments sign a student off before they graduate. The *effective*
 * status of each department is auto-derived from the operational tables —
 * an open fee record, a book not returned, an un-vacated room, a failed
 * course — unless a department head has recorded a manual decision that
 * overrides it. See app/dashboard/student/clearance and
 * app/dashboard/admin/clearance.
 *
 * Client-safe constants/types live in lib/clearance-shared.ts so the browser
 * bundle never imports this server module.
 */

function normalizeManual(value: string | null | undefined): ClearanceStatus | null {
  if (value === 'CLEARED' || value === 'PENDING') return value
  return null
}

/* ── Auto checks: read straight from the operational tables ────────────────── */

async function autoCheck(
  department: ClearanceDepartment,
  studentId: string,
  collegeId: string
): Promise<{ status: ClearanceStatus; reason: string | null }> {
  switch (department) {
    case 'FINANCE': {
      const records = await prisma.feeRecord.findMany({
        where: { collegeId, studentId },
        select: {
          status: true,
          amountPaid: true,
          feeStructure: { select: { amount: true } },
        },
      })
      const open = records.filter(
        (r) => r.status !== 'PAID' && r.status !== 'WAIVED' && r.amountPaid < r.feeStructure.amount
      )
      if (open.length === 0) return { status: 'CLEARED', reason: null }
      const outstanding = open.reduce((s, r) => s + (r.feeStructure.amount - r.amountPaid), 0)
      return {
        status: 'PENDING',
        reason: `${open.length} fee record${open.length === 1 ? '' : 's'} · ${formatCurrency(outstanding)} outstanding`,
      }
    }

    case 'LIBRARY': {
      const issues = await prisma.libraryIssue.findMany({
        where: { collegeId, studentId },
        select: { returnedAt: true, fineAmount: true },
      })
      const unreturned = issues.filter((i) => i.returnedAt === null).length
      const fineTotal = issues.filter((i) => i.fineAmount > 0).reduce((s, i) => s + i.fineAmount, 0)
      if (unreturned === 0 && fineTotal === 0) return { status: 'CLEARED', reason: null }
      const bits: string[] = []
      if (unreturned > 0) bits.push(`${unreturned} book${unreturned === 1 ? '' : 's'} not returned`)
      if (fineTotal > 0) bits.push(`${formatCurrency(fineTotal)} in unpaid fines`)
      return { status: 'PENDING', reason: bits.join(' · ') }
    }

    case 'HOSTEL': {
      const active = await prisma.hostelAllocation.findFirst({
        where: { collegeId, studentId, vacatedAt: null },
        select: { id: true },
      })
      if (!active) return { status: 'CLEARED', reason: null }
      return { status: 'PENDING', reason: 'Room not yet vacated' }
    }

    case 'ACADEMICS': {
      const results = await prisma.examResult.findMany({
        where: { collegeId, studentId, publishedAt: { not: null } },
        select: { grade: true },
      })
      const backlogs = results.filter((r) => !isPassingGrade(r.grade))
      if (backlogs.length === 0) return { status: 'CLEARED', reason: null }
      return { status: 'PENDING', reason: `${backlogs.length} backlogged (failed) course${backlogs.length === 1 ? '' : 's'}` }
    }
  }
}

/* ── Per-student summary (the student's own page + the admin row) ──────────── */

export interface ClearanceSummary {
  departments: DepartmentClearance[]
  overall: ClearanceStatus
  pending: ClearanceDepartment[]
}

function toDepartmentClearance(
  department: ClearanceDepartment,
  auto: { status: ClearanceStatus; reason: string | null },
  decision: {
    manualStatus: string | null
    decidedAt: Date | null
    note: string | null
    decidedBy: { name: string } | null
  } | null
): DepartmentClearance {
  const manualStatus = normalizeManual(decision?.manualStatus)
  const status = manualStatus ?? auto.status
  return {
    department,
    label: CLEARANCE_META[department].label,
    icon: CLEARANCE_META[department].icon,
    autoStatus: auto.status,
    autoReason: auto.reason,
    manualStatus,
    status,
    overridden: manualStatus !== null && manualStatus !== auto.status,
    decidedByName: decision?.decidedBy?.name ?? null,
    decidedAt: decision?.decidedAt ? decision.decidedAt.toISOString() : null,
    note: decision?.note ?? null,
  }
}

/** Full clearance for one student, combining the auto checks with any manual override. */
export async function getClearance(
  studentId: string,
  collegeId: string
): Promise<ClearanceSummary> {
  const decisions = await prisma.clearance.findMany({
    where: { collegeId, studentId },
    select: {
      department: true,
      manualStatus: true,
      decidedAt: true,
      note: true,
      decidedBy: { select: { name: true } },
    },
  })
  const byDept = new Map(decisions.map((d) => [d.department, d]))

  const departments: DepartmentClearance[] = []
  for (const department of CLEARANCE_DEPARTMENTS) {
    const auto = await autoCheck(department, studentId, collegeId)
    departments.push(toDepartmentClearance(department, auto, byDept.get(department) ?? null))
  }

  const pending = departments.filter((d) => d.status === 'PENDING').map((d) => d.department)
  return { departments, overall: pending.length === 0 ? 'CLEARED' : 'PENDING', pending }
}

/* ── Admin overview: every student, with batched auto checks ─────────────────
 *
 * Computes the auto status for all students in four grouped/filtered queries
 * rather than 4 × N, then folds the manual overrides on top. Designed for the
 * clearance console's table, not for thousands of rows. */

export async function getAllClearance(collegeId: string | null): Promise<{
  students: StudentClearanceRow[]
}> {
  const where = collegeId ? { collegeId } : {}
  const students = await prisma.user.findMany({
    where: { ...where, role: 'STUDENT' },
    select: { id: true, regno: true, name: true },
    orderBy: { regno: 'asc' },
    take: 500,
  })
  if (students.length === 0) return { students: [] }

  const ids = students.map((s) => s.id)

  // Auto checks as per-student aggregates.
  const [feeRecords, libraryIssues, hostelAllocations, examResults, decisions] = await Promise.all([
    prisma.feeRecord.findMany({
      where: { ...where, studentId: { in: ids } },
      select: { studentId: true, status: true, amountPaid: true, feeStructure: { select: { amount: true } } },
    }),
    prisma.libraryIssue.findMany({
      where: { ...where, studentId: { in: ids } },
      select: { studentId: true, returnedAt: true, fineAmount: true },
    }),
    prisma.hostelAllocation.findMany({
      where: { ...where, studentId: { in: ids }, vacatedAt: null },
      select: { studentId: true },
    }),
    prisma.examResult.findMany({
      where: { ...where, studentId: { in: ids }, publishedAt: { not: null } },
      select: { studentId: true, grade: true },
    }),
    prisma.clearance.findMany({
      where: { ...where, studentId: { in: ids } },
      select: {
        studentId: true,
        department: true,
        manualStatus: true,
        decidedAt: true,
        note: true,
        decidedBy: { select: { name: true } },
      },
    }),
  ])

  const feeOpen = new Map<string, number>()
  for (const r of feeRecords) {
    if (r.status !== 'PAID' && r.status !== 'WAIVED' && r.amountPaid < r.feeStructure.amount) {
      feeOpen.set(r.studentId, (feeOpen.get(r.studentId) ?? 0) + 1)
    }
  }
  const libOpen = new Map<string, { books: number; fines: number }>()
  for (const i of libraryIssues) {
    const entry = libOpen.get(i.studentId) ?? { books: 0, fines: 0 }
    if (i.returnedAt === null) entry.books += 1
    if (i.fineAmount > 0) entry.fines += i.fineAmount
    libOpen.set(i.studentId, entry)
  }
  const hostelOpen = new Set(hostelAllocations.map((h) => h.studentId))
  const acadBacklog = new Map<string, number>()
  for (const r of examResults) {
    if (!isPassingGrade(r.grade)) acadBacklog.set(r.studentId, (acadBacklog.get(r.studentId) ?? 0) + 1)
  }

  const decisionsByStudent = new Map<string, Map<ClearanceDepartment, (typeof decisions)[number]>>()
  for (const d of decisions) {
    const map = decisionsByStudent.get(d.studentId) ?? new Map()
    map.set(d.department as ClearanceDepartment, d)
    decisionsByStudent.set(d.studentId, map)
  }

  const rows: StudentClearanceRow[] = students.map((s) => {
    const build = (department: ClearanceDepartment): DepartmentClearance => {
      let auto: { status: ClearanceStatus; reason: string | null }
      switch (department) {
        case 'FINANCE': {
          const n = feeOpen.get(s.id) ?? 0
          auto = n === 0
            ? { status: 'CLEARED', reason: null }
            : { status: 'PENDING', reason: `${n} fee record${n === 1 ? '' : 's'} outstanding` }
          break
        }
        case 'LIBRARY': {
          const v = libOpen.get(s.id)
          if (!v || (v.books === 0 && v.fines === 0)) auto = { status: 'CLEARED', reason: null }
          else {
            const bits: string[] = []
            if (v.books > 0) bits.push(`${v.books} book${v.books === 1 ? '' : 's'} not returned`)
            if (v.fines > 0) bits.push(`${formatCurrency(v.fines)} in unpaid fines`)
            auto = { status: 'PENDING', reason: bits.join(' · ') }
          }
          break
        }
        case 'HOSTEL':
          auto = hostelOpen.has(s.id)
            ? { status: 'PENDING', reason: 'Room not yet vacated' }
            : { status: 'CLEARED', reason: null }
          break
        case 'ACADEMICS': {
          const n = acadBacklog.get(s.id) ?? 0
          auto = n === 0
            ? { status: 'CLEARED', reason: null }
            : { status: 'PENDING', reason: `${n} backlogged (failed) course${n === 1 ? '' : 's'}` }
          break
        }
      }
      return toDepartmentClearance(department, auto, decisionsByStudent.get(s.id)?.get(department) ?? null)
    }

    const departments = CLEARANCE_DEPARTMENTS.map(build)
    const pending = departments.filter((d) => d.status === 'PENDING').map((d) => d.department)
    return {
      studentId: s.id,
      regno: s.regno,
      name: s.name,
      departments,
      overall: pending.length === 0 ? 'CLEARED' : 'PENDING',
      pending,
    }
  })

  return { students: rows }
}

/* ── Write: a department head (or admin) records a decision ────────────────── */

export interface ClearanceDecisionInput {
  studentId: string
  department: ClearanceDepartment
  /** 'CLEARED' | 'PENDING' overrides the auto check; null clears the override. */
  manualStatus: ClearanceStatus | null
  note?: string
}

/**
 * Persist a manual clearance decision.
 *
 * Department-head scoping: a non-admin actor may only sign off the department
 * they own (LIBRARIAN→Library, WARDEN→Hostel, FINANCE→Finance, HOD→Academics).
 * ADMIN may decide any department. Passing `manualStatus: null` deletes the
 * override so the live auto check governs again.
 */
export async function recordClearanceDecision(
  ctx: AuthContext,
  input: ClearanceDecisionInput
): Promise<MutationResult<{ department: ClearanceDepartment; status: ClearanceStatus | null }>> {
  const { studentId, department, manualStatus, note } = input
  if (!CLEARANCE_DEPARTMENTS.includes(department)) {
    return { ok: false, error: 'Unknown department' }
  }
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  if (!ctx.can(PERMISSIONS.CLEARANCE_MANAGE)) {
    return { ok: false, error: 'You do not have permission to manage clearance' }
  }
  if (!canDecideDepartment(ctx.user.role, department)) {
    const owner = CLEARANCE_META[department].ownerRole
    return {
      ok: false,
      error: `Only ${owner} or an administrator may decide ${CLEARANCE_META[department].label} clearance`,
    }
  }

  try {
    const student = await prisma.user.findFirst({
      where: { id: studentId, collegeId, role: 'STUDENT' },
      select: { id: true, regno: true, name: true },
    })
    if (!student) return { ok: false, error: 'Student not found in your college' }

    const before = await prisma.clearance.findUnique({
      where: { studentId_department: { studentId, department } },
      select: { manualStatus: true },
    })

    if (manualStatus === null) {
      // Revert to the live auto check.
      await prisma.clearance.deleteMany({ where: { studentId, department } })
    } else {
      await prisma.clearance.upsert({
        where: { studentId_department: { studentId, department } },
        update: {
          manualStatus,
          decidedByUserId: ctx.user.id,
          decidedAt: new Date(),
          note: note?.trim() || null,
        },
        create: {
          collegeId,
          studentId,
          department,
          manualStatus,
          decidedByUserId: ctx.user.id,
          decidedAt: new Date(),
          note: note?.trim() || null,
        },
      })
    }

    await audit({
      ctx,
      agentName: 'clearance',
      actionType: 'CLEARANCE_DECISION',
      targetEntity: 'Clearance',
      entityId: `${student.regno}:${department}`,
      before: { manualStatus: before?.manualStatus ?? null },
      after: {
        manualStatus,
        department,
        student: student.regno,
        note: note?.trim() || null,
      },
    })

    return { ok: true, data: { department, status: manualStatus } }
  } catch (error) {
    console.error('[clearance] decision failed', error)
    return { ok: false, error: 'Could not record the clearance decision' }
  }
}
