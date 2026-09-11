import { redirect } from 'next/navigation'
import { getSession } from '@/lib/rbac'
import { getDashboardPath } from '@/lib/roles'

/** Bare /dashboard → the caller's own role dashboard. */
export default async function DashboardIndex() {
  const session = await getSession()
  if (!session) redirect('/login')
  redirect(getDashboardPath(session.role))
}
