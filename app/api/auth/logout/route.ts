import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getSessionFromRequest } from '@/lib/rbac'

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)

  if (session) {
    await audit({
      agentName: 'auth',
      actionType: 'LOGOUT',
      targetEntity: 'User',
      entityId: session.userId,
      collegeId: session.collegeId,
      actorId: session.userId,
      after: { regno: session.regno },
    })
  }

  const res = NextResponse.json({ ok: true })
  // Expire the cookie immediately; attributes must match the ones used to set it.
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })
  return res
}

/**
 * GET variant: clears the cookie and redirects to /login, for server-side
 * redirects (requireUser() etc. can't set cookies from a Server Component —
 * only a Route Handler, middleware, or Server Action can).
 *
 * Without this, a session whose JWT still verifies but whose userId no
 * longer exists (e.g. after a DB reset/reseed) never gets cleared: proxy.ts
 * sees "a session exists" and bounces /login back to the dashboard, which
 * fails its own DB check and redirects to /login again — an infinite loop.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/login', req.url))
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })
  return res
}
