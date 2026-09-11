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
