import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/rbac'
import { ROLE_LABEL, SLUG_ROLE } from '@/lib/roles'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Role landing route: /dashboard/<slug>
 *
 * Phase 0 placeholder — it exists so login auto-redirect and the role-route
 * guard have somewhere to land and can actually be tested. Real feature
 * dashboards are Phase 1+.
 */
export default async function RoleDashboardPage({
  params,
}: {
  params: Promise<{ role: string }>
}) {
  const { role: slug } = await params

  const role = SLUG_ROLE[slug]
  if (!role) notFound()

  // Tier 1: /dashboard/<slug> must belong to the caller's own role.
  const ctx = await requireUser({ route: slug })

  const firstName = ctx.user.name.split(' ')[0]
  const permissions = Array.from(ctx.permissions).sort()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Signed in as <span className="num text-foreground">{ctx.user.regno}</span> ·{' '}
          {ROLE_LABEL[role]}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Role', value: ROLE_LABEL[role] },
          { label: 'Status', value: ctx.user.status },
          { label: 'Permissions', value: String(permissions.length) },
        ].map((stat) => (
          <Card key={stat.label} className="p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">
              {stat.label}
            </p>
            <p className="num mt-2 text-xl font-semibold text-foreground">{stat.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Effective permissions</CardTitle>
          <p className="text-sm text-muted">
            Tier 2 RBAC — role grants with per-user overrides applied.
          </p>
        </CardHeader>
        <CardContent>
          {permissions.length === 0 ? (
            <p className="text-sm text-subtle">No permissions granted to this role.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {permissions.map((key) => (
                <li
                  key={key}
                  className="num rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
                >
                  {key}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-subtle">
        Phase 0 foundation is in place — auth, role routing and permissions. Module screens land in
        Phase 1.
      </p>
    </div>
  )
}
