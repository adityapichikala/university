'use server'

import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { audit } from '@/lib/audit'
import type { MutationResult } from '@/lib/permissions'
import { asAdmissionStatus, type AdmissionStatus } from '@/lib/admissions'

/**
 * Admission mutations (doc §7 — admissions pipeline).
 *
 * Guarded by `admission.manage`. Two distinct powers live here:
 *   • decide  — move an application to APPROVED / REJECTED
 *   • convert — turn an APPROVED applicant into a real student account
 * Keeping them separate matters: approving an offer and provisioning an
 * account are different acts, and only the latter creates a login.
 *
 * Every action is college-scoped and re-reads the row rather than trusting
 * the status the browser sent, so a stale tab cannot skip a stage.
 */

/** Next free STUxxx registration number. Loops to survive a collision. */
async function nextStudentRegno(collegeId: string): Promise<string> {
  const existing = await prisma.user.findMany({
    where: { collegeId, regno: { startsWith: 'STU' } },
    select: { regno: true },
  })
  const used = new Set(existing.map((u) => u.regno))
  let n = existing.length + 1
  let candidate = `STU${String(n).padStart(3, '0')}`
  while (used.has(candidate)) {
    n += 1
    candidate = `STU${String(n).padStart(3, '0')}`
  }
  return candidate
}

async function loadAdmission(id: string, collegeId: string) {
  return prisma.admission.findFirst({
    where: { id, collegeId },
    select: {
      id: true,
      applicantName: true,
      email: true,
      programAppliedFor: true,
      status: true,
      convertedToUserId: true,
    },
  })
}

export async function decideAdmission(input: {
  id: string
  decision: 'APPROVED' | 'REJECTED'
}): Promise<MutationResult<{ id: string; status: AdmissionStatus }>> {
  const ctx = await requirePermission(PERMISSIONS.ADMISSION_MANAGE, { route: 'admin' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  const decision = input?.decision
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return { ok: false, error: 'Unknown decision' }
  }

  try {
    const admission = await loadAdmission(input.id, collegeId)
    if (!admission) return { ok: false, error: 'Application not found' }

    const current = asAdmissionStatus(admission.status)
    if (current === 'CONVERTED') {
      return { ok: false, error: 'Already enrolled as a student — this application is closed' }
    }
    if (current === decision) {
      return { ok: false, error: `Already ${decision.toLowerCase()}` }
    }
    if (current === 'REJECTED') {
      return { ok: false, error: 'This application was rejected — ask the office to reopen it' }
    }

    const updated = await prisma.admission.update({
      where: { id: admission.id },
      data: { status: decision },
      select: { id: true, status: true },
    })

    await audit({
      ctx,
      agentName: 'admin',
      actionType: `ADMISSION_${decision}`,
      targetEntity: 'Admission',
      entityId: admission.id,
      before: { status: current },
      after: { status: decision, applicant: admission.applicantName },
    })

    revalidatePath('/dashboard/admin/admissions')
    return { ok: true, data: { id: updated.id, status: asAdmissionStatus(updated.status) } }
  } catch (error) {
    console.error('[admissions] decision failed', error)
    return { ok: false, error: 'Could not record that decision' }
  }
}

/**
 * Convert an APPROVED applicant into a student account.
 *
 * Writes both rows in one transaction: a half-created student with no
 * matching application status is exactly the kind of mess that is painful to
 * unwind later.
 */
export async function convertAdmission(input: {
  id: string
}): Promise<MutationResult<{ regno: string; temporaryPassword: string; name: string }>> {
  const ctx = await requirePermission(PERMISSIONS.ADMISSION_MANAGE, { route: 'admin' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  try {
    const admission = await loadAdmission(input.id, collegeId)
    if (!admission) return { ok: false, error: 'Application not found' }

    const current = asAdmissionStatus(admission.status)
    if (current === 'CONVERTED') {
      return { ok: false, error: 'Already converted to a student account' }
    }
    if (current !== 'APPROVED') {
      return {
        ok: false,
        error:
          current === 'REJECTED'
            ? 'This application was rejected'
            : 'Approve the application before enrolling it',
      }
    }

    // Re-entry guard: even a stale row pointing at a user counts as converted.
    if (admission.convertedToUserId) {
      return { ok: false, error: 'Already converted to a student account' }
    }

    // The email is @unique across the college — a duplicate would mean either
    // an existing account or a second application for the same person.
    const clash = await prisma.user.findUnique({
      where: { email: admission.email },
      select: { regno: true },
    })
    if (clash) {
      return { ok: false, error: `An account already exists for this email (${clash.regno})` }
    }

    const regno = await nextStudentRegno(collegeId)
    // Per-account rather than a shared demo password — the admin is shown it
    // once and the applicant should change it at first login.
    const temporaryPassword = `Welcome@${regno}`
    const passwordHash = await bcrypt.hash(temporaryPassword, 10)

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          collegeId,
          regno,
          name: admission.applicantName,
          email: admission.email,
          passwordHash,
          role: 'STUDENT',
          status: 'ACTIVE',
        },
        select: { id: true, regno: true, name: true },
      })

      await tx.admission.update({
        where: { id: admission.id },
        data: {
          status: 'CONVERTED',
          convertedToUserId: user.id,
          convertedByUserId: ctx.user.id,
        },
      })

      return user
    })

    await audit({
      ctx,
      agentName: 'admin',
      actionType: 'ADMISSION_CONVERT',
      targetEntity: 'Admission',
      entityId: admission.id,
      before: { status: 'APPROVED' },
      after: {
        status: 'CONVERTED',
        applicant: admission.applicantName,
        regno: result.regno,
        program: admission.programAppliedFor,
      },
    })

    revalidatePath('/dashboard/admin/admissions')
    revalidatePath('/dashboard/admin/users')
    return {
      ok: true,
      data: { regno: result.regno, temporaryPassword, name: result.name },
    }
  } catch (error) {
    console.error('[admissions] conversion failed', error)
    return { ok: false, error: 'Could not enrol that applicant' }
  }
}
