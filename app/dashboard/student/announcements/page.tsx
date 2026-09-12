import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/rbac'
import { fetchAnnouncementFeed } from '@/lib/announcements'
import { ToastProvider } from '@/components/ui/toast'
import { AnnouncementInbox } from './AnnouncementInbox'

export const metadata = { title: 'Announcements · Apex University ERP' }

/**
 * Student › Announcements.
 *
 * Uses the same `fetchAnnouncementFeed()` the REST route and the dashboard
 * banner use, so the audience rule exists exactly once. Expired notices are
 * filtered in the query — a notice that has lapsed is not "yours" any more.
 */
export default async function StudentAnnouncementsPage() {
  const ctx = await requireUser({ route: 'student' })

  const enrollments = await prisma.courseEnrollment.findMany({
    where: { studentId: ctx.user.id },
    select: { classId: true },
  })

  const feed = await fetchAnnouncementFeed(prisma, {
    collegeId: ctx.user.collegeId ?? '',
    user: {
      id: ctx.user.id,
      role: ctx.user.role,
      departmentId: ctx.user.departmentId,
      classIds: Array.from(new Set(enrollments.map((e) => e.classId).filter(Boolean) as string[])),
    },
    take: 50,
  })

  const announcements = feed.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    priority: a.priority,
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    author: a.createdBy.name,
    audience: a.audience,
    readAt: a.readAt ? a.readAt.toISOString() : null,
    named: a.named,
  }))

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          Announcements
        </h1>
        <p className="mt-1 text-sm text-muted">
          Notices addressed to your role, department, class or to you by name.
        </p>
      </div>

      <ToastProvider>
        <AnnouncementInbox announcements={announcements} />
      </ToastProvider>
    </div>
  )
}
