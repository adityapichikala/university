import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import {
  ANNOUNCEMENT_SELECT,
  audienceLabel,
  readReceipts,
  resolveAudience,
} from '@/lib/announcements'
import { ToastProvider } from '@/components/ui/toast'
import { AnnouncementComposer } from './AnnouncementComposer'

export const metadata = { title: 'Announcements · Apex University ERP' }

/**
 * Teacher › Announcements.
 *
 * Compose a broadcast and watch the receipts. The "read by N of M" figure is
 * recomputed on every load from the *current* audience — so it stays honest
 * when students join or leave the target group after posting.
 */
export default async function TeacherAnnouncementsPage() {
  const ctx = await requirePermission(PERMISSIONS.ANNOUNCEMENT_BROADCAST, { route: 'teacher' })

  const [rows, classes, students] = await Promise.all([
    prisma.notification.findMany({
      where: scopes.college(ctx),
      select: ANNOUNCEMENT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.class.findMany({
      where: scopes.college(ctx),
      select: { id: true, name: true, semester: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { ...scopes.college(ctx), role: 'STUDENT' },
      select: { id: true, name: true, regno: true },
      orderBy: { regno: 'asc' },
    }),
  ])

  // One audience resolution + one grouped count per announcement.
  const sent = await Promise.all(
    rows.map(async (n) => {
      const audienceIds = await resolveAudience(prisma, {
        collegeId: ctx.user.collegeId ?? '',
        targetRole: n.targetRole,
        targetDepartmentId: n.targetDepartmentId,
        targetClassId: n.targetClassId,
        targetUserIds: n.targets.map((t) => t.userId),
      })
      const receipts = await readReceipts(prisma, { notificationId: n.id, audienceIds })
      return {
        id: n.id,
        title: n.title,
        body: n.body,
        priority: n.priority,
        expiresAt: n.expiresAt ? n.expiresAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
        author: n.createdBy.regno,
        audienceLabel: audienceLabel({
          targetRole: n.targetRole,
          targetDepartmentName: n.targetDepartment?.name ?? null,
          targetClassName: n.targetClass?.name ?? null,
          explicitCount: n.targets.length,
        }),
        receipts,
      }
    })
  )

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          Announcements
        </h1>
        <p className="mt-1 text-sm text-muted">
          Post a notice to a role, department, class or named students. Read receipts are derived
          from the current audience — not frozen at post time.
        </p>
      </div>

      <ToastProvider>
        <AnnouncementComposer
          classes={classes}
          students={students}
          sent={sent}
          canPickDepartment={ctx.user.role !== 'TEACHER'}
        />
      </ToastProvider>
    </div>
  )
}
