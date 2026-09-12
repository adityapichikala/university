'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { audit } from '@/lib/audit'
import type { MutationResult } from '@/lib/permissions'

/**
 * Hostel leave, warden side.
 *
 * `decideHostelLeave` lives next to the student actions in
 * `app/dashboard/student/hostel/actions.ts`, but the warden screen should not
 * import from a student route — a route folder is not a library. This module
 * holds the warden-facing entry point so the dependency points one way.
 */

export async function bulkDecideHostelLeave(input: {
  ids: string[]
  decision: 'APPROVED' | 'REJECTED'
  note?: string
}): Promise<MutationResult<{ decided: number; skipped: number }>> {
  const ctx = await requirePermission(PERMISSIONS.HOSTEL_MANAGE, { route: 'warden' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') {
    return { ok: false, error: 'Unknown decision' }
  }
  const ids = Array.from(new Set((input.ids ?? []).filter(Boolean)))
  if (ids.length === 0) return { ok: false, error: 'Select at least one request' }

  try {
    // Only rows that are still PENDING can move. Filtering in the WHERE clause
    // means a request decided in another tab cannot be decided twice.
    const pending = await prisma.hostelLeave.findMany({
      where: { id: { in: ids }, ...scopes.college(ctx), status: 'PENDING' },
      select: { id: true, student: { select: { regno: true } } },
    })

    if (pending.length === 0) {
      return { ok: true, data: { decided: 0, skipped: ids.length } }
    }

    const note = input.note?.trim() || null
    await prisma.$transaction(
      pending.map((row) =>
        prisma.hostelLeave.update({
          where: { id: row.id },
          data: {
            status: input.decision,
            decidedByUserId: ctx.user.id,
            decidedAt: new Date(),
            decisionNote: note,
          },
        })
      )
    )

    await audit({
      ctx,
      agentName: 'hostel',
      actionType: `HOSTEL_LEAVE_${input.decision}`,
      targetEntity: 'HostelLeave',
      entityId: pending.map((r) => r.id).join(','),
      after: { count: pending.length, regnos: pending.map((r) => r.student.regno), note },
    })

    revalidatePath('/dashboard/warden')
    revalidatePath('/dashboard/student/hostel')
    return { ok: true, data: { decided: pending.length, skipped: ids.length - pending.length } }
  } catch (error) {
    console.error('[hostel-leave] bulk decision failed', error)
    return { ok: false, error: 'Could not record those decisions' }
  }
}
