'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { audit } from '@/lib/audit'
import { CERTIFICATE_TYPES, isCertificateType } from '@/lib/certificates'

/**
 * Certificate issuance (Phase 4, doc §7).
 *
 * Guarded by `certificate.issue`. The student is re-looked-up inside the
 * caller's college rather than trusted from the client, so a registrar cannot
 * mint a certificate for a student at another tenant by posting an id.
 *
 * This module exports exactly one thing — the async action. Constants and type
 * guards live in `lib/certificates.ts` because a `'use server'` file may only
 * export async functions.
 */

export interface IssueCertificateResult {
  ok: boolean
  error?: string
  certificateId?: string
}

export async function issueCertificate(input: {
  studentId: string
  type: string
}): Promise<IssueCertificateResult> {
  const ctx = await requirePermission(PERMISSIONS.CERTIFICATE_ISSUE)

  if (!isCertificateType(input.type)) {
    return { ok: false, error: `Type must be one of ${CERTIFICATE_TYPES.join(', ')}` }
  }
  if (!ctx.user.collegeId) {
    return { ok: false, error: 'No college scope' }
  }

  try {
    // Re-resolve the student under the caller's college — never trust the id.
    const student = await prisma.user.findFirst({
      where: { id: input.studentId, collegeId: ctx.user.collegeId, role: 'STUDENT' },
      select: { id: true, name: true, regno: true },
    })

    if (!student) return { ok: false, error: 'Student not found in your college' }

    const certificate = await prisma.certificate.create({
      data: {
        collegeId: ctx.user.collegeId,
        studentId: student.id,
        type: input.type,
        // Placeholder until document generation lands — the record of
        // issuance is the authoritative part for now.
        fileUrl: `/certificates/${student.regno}-${input.type.toLowerCase()}.pdf`,
      },
      select: { id: true, type: true, issuedAt: true, fileUrl: true },
    })

    await audit({
      ctx,
      agentName: 'registrar',
      actionType: 'CERTIFICATE_ISSUE',
      targetEntity: 'Certificate',
      entityId: certificate.id,
      before: null,
      after: {
        type: certificate.type,
        student: student.regno,
        fileUrl: certificate.fileUrl,
      },
    })

    revalidatePath('/dashboard/registrar')
    return { ok: true, certificateId: certificate.id }
  } catch (error) {
    console.error('[registrar] issue failed', error)
    return { ok: false, error: 'Could not issue that certificate' }
  }
}
