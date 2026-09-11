import { NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getDashboardPath } from '@/lib/roles'

const loginSchema = z.object({
  regno: z.string().trim().min(1, 'Registration number is required').max(64),
  password: z.string().min(1, 'Password is required').max(200),
})

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = loginSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
  }

  const regno = parsed.data.regno.toUpperCase()
  const user = await prisma.user.findUnique({ where: { regno } })

  // Same message for unknown user and wrong password — no user enumeration.
  const invalid = NextResponse.json(
    { error: 'Invalid registration number or password' },
    { status: 401 }
  )

  // Failures are audited too — a brute-force pattern is only visible if you log it.
  if (!user) {
    await audit({
      agentName: 'auth',
      actionType: 'LOGIN_FAILURE',
      targetEntity: 'User',
      status: 'REJECTED',
      after: { regno, reason: 'unknown_regno' },
    })
    return invalid
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash)
  if (!passwordOk) {
    await audit({
      agentName: 'auth',
      actionType: 'LOGIN_FAILURE',
      targetEntity: 'User',
      entityId: user.id,
      status: 'REJECTED',
      collegeId: user.collegeId,
      after: { regno, reason: 'bad_password' },
    })
    return invalid
  }

  if (user.status !== 'ACTIVE') {
    await audit({
      agentName: 'auth',
      actionType: 'LOGIN_FAILURE',
      targetEntity: 'User',
      entityId: user.id,
      status: 'REJECTED',
      collegeId: user.collegeId,
      after: { regno, reason: 'inactive' },
    })
    return NextResponse.json({ error: 'Account is not active' }, { status: 403 })
  }

  await audit({
    agentName: 'auth',
    actionType: 'LOGIN_SUCCESS',
    targetEntity: 'User',
    entityId: user.id,
    collegeId: user.collegeId,
    actorId: user.id,
    after: { regno: user.regno, role: user.role },
  })

  const token = await signSession({
    userId: user.id,
    regno: user.regno,
    role: user.role,
    collegeId: user.collegeId,
    departmentId: user.departmentId,
    name: user.name,
  })

  const res = NextResponse.json({
    ok: true,
    redirect: getDashboardPath(user.role),
    user: { regno: user.regno, name: user.name, role: user.role },
  })

  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
  return res
}
