import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/rbac'
import { isRole } from '@/lib/roles'
import { fetchAnnouncementFeed } from '@/lib/announcements'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { getNav } from '@/components/dashboard/nav-items'
import {
  AnnouncementBanner,
  type BannerAnnouncement as AnnouncementBannerItem,
} from '@/components/dashboard/announcement-banner'

/**
 * Dashboard shell — role-aware Sidebar + Header for every /dashboard/* route.
 *
 * requireUser() runs the full chain (verify JWT → load user → role route) and
 * redirects before a single pixel is rendered. Per-role ownership of the route
 * itself is re-asserted in app/dashboard/[role]/page.tsx.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await requireUser()

  const role = isRole(ctx.user.role) ? ctx.user.role : 'STUDENT'
  const sections = getNav(role)
  const slug = role.toLowerCase()

  // Only these two roles have a full board page today; the banner still runs
  // for everyone, it just has nowhere to link "+N more" for the others.
  const boardHref =
    role === 'STUDENT' || role === 'TEACHER' ? `/dashboard/${slug}/announcements` : undefined

  const [college, enrollments] = await Promise.all([
    ctx.user.collegeId
      ? prisma.college.findUnique({
          where: { id: ctx.user.collegeId },
          select: { name: true },
        })
      : null,
    prisma.courseEnrollment.findMany({
      where: { studentId: ctx.user.id },
      select: { classId: true },
    }),
  ])

  // Header badge + banner both need the live board. One read per request,
  // resolved through the same audience rule the REST feed uses.
  let unreadCount = 0
  let bannerItems: AnnouncementBannerItem[] = []
  if (ctx.user.collegeId) {
    try {
      const feed = await fetchAnnouncementFeed(prisma, {
        collegeId: ctx.user.collegeId,
        user: {
          id: ctx.user.id,
          role: ctx.user.role,
          departmentId: ctx.user.departmentId,
          classIds: Array.from(
            new Set(enrollments.map((e) => e.classId).filter(Boolean) as string[])
          ),
        },
      })
      unreadCount = feed.filter((a) => !a.readAt).length
      bannerItems = feed.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        priority: a.priority,
        expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
        createdBy: { name: a.createdBy.name, regno: a.createdBy.regno },
        audience: a.audience,
        readAt: a.readAt ? a.readAt.toISOString() : null,
      }))
    } catch {
      // A broken inbox must never 500 the whole dashboard — the banner and
      // bell simply render empty.
      unreadCount = 0
      bannerItems = []
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar sections={sections} role={role} collegeName={college?.name} />

      <div className="lg:pl-[264px]">
        <Header
          sections={sections}
          collegeName={college?.name}
          user={{
            name: ctx.user.name,
            regno: ctx.user.regno,
            email: ctx.user.email,
            role,
          }}
          unreadCount={unreadCount}
          notificationsHref={boardHref}
        />

        {/* Banner sits at the top of <main>, not above it, so the page keeps
            one consistent gutter whether or not there is anything to show. */}
        <main className="px-4 py-6 lg:px-8 lg:py-8">
          <AnnouncementBanner announcements={bannerItems} moreHref={boardHref} />
          {children}
        </main>
      </div>
    </div>
  )
}
