import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { asAdmissionStatus } from '@/lib/admissions'
import { ToastProvider } from '@/components/ui/toast'
import { AdmissionsClient } from './AdmissionsClient'

export const metadata = { title: 'Admissions · Apex University ERP' }

/**
 * Admin › Admissions (doc §7).
 *
 * Tier 1 (`route: 'admin'`) + Tier 2 (`admission.manage`) + Tier 3 (college
 * scope on the query and again inside every action).
 */
export default async function AdminAdmissionsPage() {
  const ctx = await requirePermission(PERMISSIONS.ADMISSION_MANAGE, { route: 'admin' })
  const college = scopes.college(ctx)

  const admissions = await prisma.admission.findMany({
    where: college,
    select: {
      id: true,
      applicantName: true,
      email: true,
      phone: true,
      programAppliedFor: true,
      meritScore: true,
      status: true,
      documentsUrl: true,
      createdAt: true,
      convertedToUserId: true,
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
  })

  const rows = admissions.map((a) => ({
    id: a.id,
    applicantName: a.applicantName,
    email: a.email,
    phone: a.phone,
    programAppliedFor: a.programAppliedFor,
    meritScore: a.meritScore,
    status: asAdmissionStatus(a.status),
    documentsUrl: a.documentsUrl,
    appliedOn: a.createdAt.toISOString().slice(0, 10),
    converted: Boolean(a.convertedToUserId),
  }))

  const pending = rows.filter((r) => r.status === 'PENDING').length
  const approved = rows.filter((r) => r.status === 'APPROVED').length
  const enrolled = rows.filter((r) => r.status === 'CONVERTED').length
  const scored = rows.filter((r) => typeof r.meritScore === 'number') as { meritScore: number }[]
  const averageMerit = scored.length
    ? scored.reduce((sum, r) => sum + r.meritScore, 0) / scored.length
    : 0

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Admissions</h1>
        <p className="mt-1 text-sm text-muted">
          Applications for the coming intake. Enrolling an applicant creates their student account
          and is written to the audit trail.
        </p>
      </div>

      <ToastProvider>
        <AdmissionsClient
          admissions={rows}
          summary={{
            total: rows.length,
            pending,
            approved,
            enrolled,
            averageMerit: Math.round(averageMerit * 10) / 10,
          }}
        />
      </ToastProvider>
    </div>
  )
}
