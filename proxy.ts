import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/auth'
import { roleSlug } from '@/lib/roles'

/** Everything under /dashboard requires a session. */
const PROTECTED = /^\/dashboard(\/.*)?$/
/** An authenticated user has no business on /login. */
const AUTH_ONLY = /^\/login$/
/** /dashboard/<slug>/… */
const ROLE_SEGMENT = /^\/dashboard\/([^/]+)/

/**
 * Dashboard routes shared by every role, not owned by one.
 *
 * `/dashboard/leave` is staff self-service: it is gated on the `leave.request`
 * *permission*, not on a role, so role-route isolation must not apply to it.
 * Skipping the redirect here is safe — proxy is only a fast first pass; the
 * authoritative check is `requirePermission()` inside the page, which runs
 * against a fresh DB row and redirects anyone without the permission.
 */
const SHARED_SEGMENTS = new Set(['leave'])

/**
 * Edge-safe session guard (architecture doc §5, step 1).
 * Next 16 renamed the `middleware` convention to `proxy` — same behaviour.
 *
 *   1. no session + /dashboard/*   → /login?from=<path>
 *   2. session  + /login           → /dashboard/<role>
 *   3. session  + /dashboard/<x>   → /dashboard/<own role> when x ≠ own role
 *
 * Fast first pass only. The authoritative check (fresh DB role, status and
 * permissions) happens in requireUser() on the server.
 */
export default async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value)

  // 1 ── unauthenticated on a protected route
  if (PROTECTED.test(pathname) && !session) {
    const url = new URL('/login', req.url)
    url.searchParams.set('from', `${pathname}${search}`)
    return NextResponse.redirect(url)
  }

  if (!session) return NextResponse.next()

  const own = `/dashboard/${roleSlug(session.role)}`

  // 2 ── authenticated user on /login
  if (AUTH_ONLY.test(pathname)) {
    return NextResponse.redirect(new URL(own, req.url))
  }

  // 3 ── role-route isolation (shared routes exempt, see SHARED_SEGMENTS)
  const match = pathname.match(ROLE_SEGMENT)
  if (match && !SHARED_SEGMENTS.has(match[1]) && match[1] !== roleSlug(session.role)) {
    return NextResponse.redirect(new URL(own, req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/login', '/dashboard/:path*'],
}
