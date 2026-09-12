'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { audit } from '@/lib/audit'
import {
  isApplicationStatus,
  asApplicationStatus,
  APPLICATION_STATUSES,
} from '@/lib/phase4-query'

/**
 * Move a placement application through the pipeline.
 *
 * Guarded by `placement.manage` (Tier 2). Placement officers are college-wide
 * by nature — a drive belongs to the college, not a department — so there is
 * no Tier 3 narrowing here, but the college scope is still enforced on the
 * lookup so an id from another tenant cannot be touched.
 */

export interface PlacementActionResult {
  ok: boolean
  error?: string
}

export async function updateApplicationStatus(input: {
  applicationId: string
  status: string
}): Promise<PlacementActionResult> {
  const ctx = await requirePermission(PERMISSIONS.PLACEMENT_MANAGE)

  if (!isApplicationStatus(input.status)) {
    return {
      ok: false,
      error: `Status must be one of ${APPLICATION_STATUSES.join(', ')}`,
    }
  }
  if (!ctx.user.collegeId) {
    return { ok: false, error: 'No college scope' }
  }

  try {
    const application = await prisma.placementApplication.findFirst({
      where: { id: input.applicationId, collegeId: ctx.user.collegeId },
      select: {
        id: true,
        status: true,
        student: { select: { id: true, name: true, regno: true } },
        drive: { select: { id: true, companyName: true, role: true } },
      },
    })

    if (!application) return { ok: false, error: 'Application not found' }

    if (application.status === input.status) {
      return { ok: false, error: `Already ${input.status.toLowerCase()}` }
    }

    const updated = await prisma.placementApplication.update({
      where: { id: application.id },
      data: { status: input.status },
      select: { id: true, status: true },
    })

    await audit({
      ctx,
      agentName: 'placement',
      actionType: 'PLACEMENT_STATUS',
      targetEntity: 'PlacementApplication',
      entityId: application.id,
      before: {
        status: application.status,
        student: application.student.regno,
        company: application.drive.companyName,
        role: application.drive.role,
      },
      after: { status: updated.status },
    })

    revalidatePath('/dashboard/placement')
    revalidatePath('/dashboard/student/placements')
    return { ok: true }
  } catch (error) {
    console.error('[placement] status update failed', error)
    return { ok: false, error: 'Could not update that application' }
  }
}

/* ── Student self-service: apply / withdraw ───────────────────────────────────── */

/**
 * Apply to a placement drive.
 *
 * Guarded by `placement.apply` (Tier 2) — this is the permission that was
 * granted to STUDENT but never enforced anywhere before this screen existed.
 * The drive is re-looked-up inside the caller's college, so a student cannot
 * apply to a drive at another tenant by posting an id.
 */
export async function applyToDrive(
  input: { driveId: string }
): Promise<PlacementActionResult> {
  const ctx = await requirePermission(PERMISSIONS.PLACEMENT_APPLY)

  if (!ctx.user.collegeId) return { ok: false, error: 'No college scope' }

  try {
    const drive = await prisma.placementDrive.findFirst({
      where: { id: input.driveId, collegeId: ctx.user.collegeId },
      select: { id: true, companyName: true, role: true, driveDate: true },
    })
    if (!drive) return { ok: false, error: 'Drive not found' }

    if (drive.driveDate.getTime() < Date.now()) {
      return { ok: false, error: 'This drive has already closed' }
    }

    const existing = await prisma.placementApplication.findUnique({
      where: { driveId_studentId: { driveId: drive.id, studentId: ctx.user.id } },
      select: { id: true, status: true },
    })
    if (existing) {
      return { ok: false, error: `You have already applied — ${existing.status.toLowerCase()}` }
    }

    const application = await prisma.placementApplication.create({
      data: {
        collegeId: ctx.user.collegeId,
        driveId: drive.id,
        studentId: ctx.user.id,
        status: 'APPLIED',
      },
      select: { id: true },
    })

    await audit({
      ctx,
      agentName: 'placement',
      actionType: 'PLACEMENT_APPLY',
      targetEntity: 'PlacementApplication',
      entityId: application.id,
      before: null,
      after: { company: drive.companyName, role: drive.role, status: 'APPLIED' },
    })

    revalidatePath('/dashboard/student/placements')
    revalidatePath('/dashboard/placement')
    return { ok: true }
  } catch (error) {
    console.error('[placement] apply failed', error)
    return { ok: false, error: 'Could not submit that application' }
  }
}

/**
 * Withdraw your own application.
 *
 * Tier 3: matched on `studentId === caller`, so nobody can pull someone else
 * out of a process. An offer (SELECTED) cannot be self-withdrawn — that has
 * to go through the placement office, which is a real rule, not a technical
 * limitation.
 */
export async function withdrawApplication(
  input: { applicationId: string }
): Promise<PlacementActionResult> {
  const ctx = await requirePermission(PERMISSIONS.PLACEMENT_APPLY)

  if (!ctx.user.collegeId) return { ok: false, error: 'No college scope' }

  try {
    const application = await prisma.placementApplication.findFirst({
      where: {
        id: input.applicationId,
        collegeId: ctx.user.collegeId,
        studentId: ctx.user.id,
      },
      select: {
        id: true,
        status: true,
        drive: { select: { id: true, companyName: true, role: true } },
      },
    })

    if (!application) return { ok: false, error: 'Application not found' }

    const status = asApplicationStatus(application.status)
    if (status === 'WITHDRAWN') return { ok: false, error: 'Already withdrawn' }
    if (status === 'SELECTED') {
      return {
        ok: false,
        error: 'You have an offer from this drive — contact the placement office to decline it',
      }
    }
    if (status === 'REJECTED') {
      return { ok: false, error: 'You were not selected for this drive' }
    }

    await prisma.placementApplication.update({
      where: { id: application.id },
      data: { status: 'WITHDRAWN' },
    })

    await audit({
      ctx,
      agentName: 'placement',
      actionType: 'PLACEMENT_WITHDRAW',
      targetEntity: 'PlacementApplication',
      entityId: application.id,
      before: { status },
      after: { status: 'WITHDRAWN', company: application.drive.companyName },
    })

    revalidatePath('/dashboard/student/placements')
    revalidatePath('/dashboard/placement')
    return { ok: true }
  } catch (error) {
    console.error('[placement] withdraw failed', error)
    return { ok: false, error: 'Could not withdraw that application' }
  }
}
