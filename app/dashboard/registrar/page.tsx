import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { CERTIFICATE_SELECT, countCertificatesByType } from '@/lib/phase4-query'
import { gradeFromPercentage } from '@/lib/academics'
import { ToastProvider } from '@/components/ui/toast'
import { RegistrarWorkspace } from './RegistrarWorkspace'

export const metadata = { title: 'Registrar · Apex University ERP' }

/**
 * Registrar portal (Phase 4, doc §7).
 *
 * Two jobs: see how results are landing across the college, and issue
 * certificates. Guarded by `certificate.issue`, which REGISTRAR, ADMIN and a
 * granted user can hold.
 */
export default async function RegistrarPage() {
  const ctx = await requirePermission(PERMISSIONS.CERTIFICATE_ISSUE, { route: 'registrar' })
  const college = scopes.college(ctx)

  const [certificates, results, students, byType] = await Promise.all([
    prisma.certificate.findMany({
      where: college,
      select: CERTIFICATE_SELECT,
      orderBy: { issuedAt: 'desc' },
      take: 50,
    }),
    prisma.examResult.findMany({
      where: college,
      select: {
        id: true,
        marksObtained: true,
        grade: true,
        publishedAt: true,
        student: { select: { id: true, name: true, regno: true } },
        exam: { select: { maxMarks: true, examType: true, course: { select: { code: true } } } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 2000,
    }),
    prisma.user.findMany({
      where: { ...college, role: 'STUDENT' },
      select: { id: true, name: true, regno: true },
      orderBy: { regno: 'asc' },
      take: 300,
    }),
    ctx.user.collegeId
      ? countCertificatesByType(prisma, ctx.user.collegeId)
      : Promise.resolve<Record<string, number>>({}),
  ])

  const graded = results.filter((r) => r.exam.maxMarks > 0)
  const averagePercent =
    graded.length === 0
      ? 0
      : Math.round(
          (graded.reduce((sum, r) => sum + (r.marksObtained / r.exam.maxMarks) * 100, 0) /
            graded.length) *
            10
        ) / 10

  const passCount = graded.filter((r) => (r.marksObtained / r.exam.maxMarks) * 100 >= 40).length
  const passRate = graded.length === 0 ? 0 : Math.round((passCount / graded.length) * 100)

  // Grade distribution across the whole college.
  const distribution = new Map<string, number>()
  for (const r of graded) {
    const grade = r.grade || gradeFromPercentage((r.marksObtained / r.exam.maxMarks) * 100)
    distribution.set(grade, (distribution.get(grade) ?? 0) + 1)
  }
  const gradeBuckets = Array.from(distribution.entries())
    .map(([grade, count]) => ({
      grade,
      count,
      percent: graded.length === 0 ? 0 : Math.round((count / graded.length) * 100),
    }))
    .sort((a, b) => b.count - a.count)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Registrar</h1>
        <p className="mt-1 text-sm text-muted">
          Results across the college and certificate issuance. Every certificate you issue is
          recorded in the audit log.
        </p>
      </div>

      <ToastProvider>
        <RegistrarWorkspace
          summary={{
            results: results.length,
            averagePercent,
            passRate,
            students: students.length,
            certificates: certificates.length,
          }}
          gradeBuckets={gradeBuckets}
          certificates={certificates.map((c) => ({
            id: c.id,
            type: c.type,
            issuedAt: c.issuedAt.toISOString().slice(0, 10),
            fileUrl: c.fileUrl,
            studentName: c.student.name,
            studentRegno: c.student.regno,
          }))}
          byType={byType}
          students={students}
          recentResults={graded.slice(0, 12).map((r) => ({
            id: r.id,
            studentName: r.student.name,
            studentRegno: r.student.regno,
            courseCode: r.exam.course.code,
            examName: r.exam.examType,
            percent: Math.round((r.marksObtained / r.exam.maxMarks) * 100),
            grade: r.grade || gradeFromPercentage((r.marksObtained / r.exam.maxMarks) * 100),
          }))}
        />
      </ToastProvider>
    </div>
  )
}
