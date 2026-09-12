'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { audit } from '@/lib/audit'
import { isDecided, isLeaveDecision, leaveDays } from '@/lib/leave'

/**
 * Approve or reject a leave request.
 *
 * Guarded twice, deliberately:
 *   • Tier 2 — `requirePermission(leave.approve)` decides who can act at all.
 *   • Tier 3 — an HOD may only decide for people in *their* department, even
 *     though HR can decide for anyone. Without the second check an HOD could
 *     approve leave for a colleague in another department by guessing an id.
 *
 * `requirePermission` redirects by throwing, so it is called outside the
 * try/catch — a redirect swallowed by a catch would silently do nothing.
 */

export interface LeaveActionResult {
  ok: boolean
  error?: string
}

export async function decideLeaveRequest(
  input: { id: string; decision: string }
): Promise<LeaveActionResult> {
  const ctx = await requirePermission(PERMISSIONS.LEAVE_APPROVE)

  if (!isLeaveDecision(input.decision)) {
    return { ok: false, error: 'Decision must be APPROVED or REJECTED' }
  }
  if (!ctx.user.collegeId) {
    return { ok: false, error: 'No college scope' }
  }

  try {
    const request = await prisma.leaveRequest.findFirst({
      where: { id: input.id, collegeId: ctx.user.collegeId },
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        reason: true,
        employee: {
          select: {
            id: true,
            departmentId: true,
            user: { select: { name: true, regno: true } },
          },
        },
      },
    })

    if (!request) return { ok: false, error: 'Leave request not found' }

    // Tier 3: HOD is scoped to their own department. ADMIN and HR are not.
    if (
      ctx.user.role === 'HOD' &&
      request.employee.departmentId !== ctx.user.departmentId
    ) {
      await audit({
        ctx,
        agentName: 'leave',
        actionType: 'LEAVE_DECIDE',
        targetEntity: 'LeaveRequest',
        entityId: input.id,
        status: 'REJECTED',
        after: { reason: 'employee is in another department', decision: input.decision },
      })
      return { ok: false, error: 'That employee is not in your department' }
    }

    if (isDecided(request.status)) {
      return { ok: false, error: `Already ${request.status.toLowerCase()}` }
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: request.id },
      data: { status: input.decision, reviewedAt: new Date() },
      select: { id: true, status: true },
    })

    await audit({
      ctx,
      agentName: 'leave',
      actionType: 'LEAVE_DECIDE',
      targetEntity: 'LeaveRequest',
      entityId: request.id,
      before: {
        status: request.status,
        employee: request.employee.user.regno,
        startDate: request.startDate,
        endDate: request.endDate,
      },
      after: { status: updated.status, decision: input.decision, reason: request.reason },
    })

    // Every screen that renders a queue refreshes.
    revalidatePath('/dashboard/hod')
    revalidatePath('/dashboard/hr')
    revalidatePath('/dashboard/leave')
    return { ok: true }
  } catch (error) {
    console.error('[leave] decide failed', error)
    return { ok: false, error: 'Could not record that decision' }
  }
}

/* ── Staff self-service (Phase 4, doc §7) ────────────────────────────────────── */

/**
 * Parse a `YYYY-MM-DD` string into a UTC-midnight Date, or null if invalid.
 *
 * Deliberately UTC: mixing local and UTC here makes "did this start today"
 * flip depending on the server's timezone. Everything below compares
 * date-only strings, so the instant never matters.
 */
function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

const iso = (date: Date) => date.toISOString().slice(0, 10)

/** File a leave request for yourself. Guarded by `leave.request` (Tier 2). */
export async function fileLeaveRequest(input: {
  startDate: string
  endDate: string
  reason: string
}): Promise<LeaveActionResult & { id?: string }> {
  const ctx = await requirePermission(PERMISSIONS.LEAVE_REQUEST)

  const startDate = parseDateOnly(input.startDate)
  const endDate = parseDateOnly(input.endDate)
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''

  if (!startDate || !endDate) return { ok: false, error: 'Pick a valid start and end date' }
  if (endDate < startDate) return { ok: false, error: 'The end date is before the start date' }
  if (reason.length < 5) return { ok: false, error: 'Give a reason of at least 5 characters' }
  if (reason.length > 500) return { ok: false, error: 'Keep the reason under 500 characters' }
  if (!ctx.user.collegeId) return { ok: false, error: 'No college scope' }

  const today = new Date()
  if (iso(startDate) < iso(today)) {
    return { ok: false, error: 'You cannot backdate a leave request' }
  }

  try {
    // Filing leave requires an Employee record — that is the row the
    // approver's department scoping hangs off.
    const employee = await prisma.employee.findUnique({
      where: { userId: ctx.user.id },
      select: { id: true, departmentId: true },
    })
    if (!employee) {
      return {
        ok: false,
        error: 'You have no employee record — ask HR to create one before filing leave',
      }
    }

    // Overlap guard: two approved leaves covering the same day is a real
    // scheduling bug, and duplicate pending requests are noise for approvers.
    const clash = await prisma.leaveRequest.findFirst({
      where: {
        collegeId: ctx.user.collegeId,
        employeeId: employee.id,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { id: true, status: true, startDate: true, endDate: true },
    })
    if (clash) {
      return {
        ok: false,
        error: `You already have a ${clash.status.toLowerCase()} request covering ${iso(
          clash.startDate
        )} – ${iso(clash.endDate)}`,
      }
    }

    const created = await prisma.leaveRequest.create({
      data: {
        collegeId: ctx.user.collegeId,
        employeeId: employee.id,
        startDate,
        endDate,
        reason,
        status: 'PENDING',
      },
      select: { id: true, startDate: true, endDate: true },
    })

    await audit({
      ctx,
      agentName: 'leave',
      actionType: 'LEAVE_FILE',
      targetEntity: 'LeaveRequest',
      entityId: created.id,
      before: null,
      after: {
        startDate: iso(created.startDate),
        endDate: iso(created.endDate),
        reason,
        days: leaveDays(created.startDate, created.endDate),
      },
    })

    revalidatePath('/dashboard/leave')
    revalidatePath('/dashboard/hod')
    revalidatePath('/dashboard/hr')
    return { ok: true, id: created.id }
  } catch (error) {
    console.error('[leave] file failed', error)
    return { ok: false, error: 'Could not file that request' }
  }
}

/**
 * Withdraw your own pending request.
 *
 * Tier 3: the row is looked up by `employee.user.id === caller`, so one staff
 * member cannot cancel another's leave by guessing an id. Decided requests are
 * frozen — only a pending one can be withdrawn.
 */
export async function cancelLeaveRequest(
  input: { id: string }
): Promise<LeaveActionResult> {
  const ctx = await requirePermission(PERMISSIONS.LEAVE_REQUEST)

  if (!ctx.user.collegeId) return { ok: false, error: 'No college scope' }

  try {
    const request = await prisma.leaveRequest.findFirst({
      where: {
        id: input.id,
        collegeId: ctx.user.collegeId,
        employee: { userId: ctx.user.id },
      },
      select: { id: true, status: true, startDate: true, endDate: true },
    })

    if (!request) return { ok: false, error: 'Request not found' }
    if (isDecided(request.status)) {
      return {
        ok: false,
        error: `Already ${request.status.toLowerCase()} — only pending requests can be withdrawn`,
      }
    }

    await prisma.leaveRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED', reviewedAt: new Date() },
    })

    await audit({
      ctx,
      agentName: 'leave',
      actionType: 'LEAVE_CANCEL',
      targetEntity: 'LeaveRequest',
      entityId: request.id,
      before: { status: request.status },
      after: { status: 'CANCELLED', startDate: iso(request.startDate), endDate: iso(request.endDate) },
    })

    revalidatePath('/dashboard/leave')
    revalidatePath('/dashboard/hod')
    revalidatePath('/dashboard/hr')
    return { ok: true }
  } catch (error) {
    console.error('[leave] cancel failed', error)
    return { ok: false, error: 'Could not withdraw that request' }
  }
}
