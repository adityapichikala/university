import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/rbac'
import { isRole } from '@/lib/roles'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { getNav } from '@/components/dashboard/nav-items'

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

  const college = ctx.user.collegeId
    ? await prisma.college.findUnique({
        where: { id: ctx.user.collegeId },
        select: { name: true },
      })
    : null

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
        />
        <main className="px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
