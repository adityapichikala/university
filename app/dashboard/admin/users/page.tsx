import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { UsersClient } from './UsersClient'

export const metadata = { title: 'User Management · Apex University ERP' }

/**
 * Admin › User Management — the screen that delivers the core requirement:
 * one person (Admin) controls who can log in and what Teachers/Students
 * can access. Guarded server-side by requirePermission("user.manage").
 */
export default async function AdminUsersPage() {
  // Tier 1 (route) + Tier 2 (permission) — redirect before rendering anything.
  const ctx = await requirePermission(PERMISSIONS.USER_MANAGE, { route: 'admin' })

  const users = await prisma.user.findMany({
    where: { ...scopes.college(ctx) },
    select: {
      id: true,
      regno: true,
      name: true,
      email: true,
      role: true,
      status: true,
      departmentId: true,
    },
    orderBy: { regno: 'asc' },
  })

  const userIds = users.map((u) => u.id)

  const [permissions, departments, overrides] = await Promise.all([
    prisma.permission.findMany({
      orderBy: { key: 'asc' },
      select: { id: true, key: true, description: true },
    }),
    prisma.department.findMany({
      where: { ...scopes.college(ctx) },
      select: { id: true, name: true },
    }),
    userIds.length
      ? prisma.userPermission.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, granted: true, permission: { select: { key: true } } },
        })
      : Promise.resolve([]),
  ])

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          User Management
        </h1>
        <p className="mt-1 text-sm text-muted">
          Create accounts and control what each person can access. Changes apply on their next
          request.
        </p>
      </div>

      <UsersClient
        currentUserId={ctx.user.id}
        initialUsers={users}
        permissions={permissions}
        departments={departments}
        initialOverrides={overrides.map((o) => ({
          userId: o.userId,
          key: o.permission.key,
          granted: o.granted,
        }))}
      />
    </div>
  )
}
