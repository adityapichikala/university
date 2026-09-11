import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS, isRole } from '@/lib/roles'

const roleSchema = z.string().refine(isRole, 'Invalid role')

const createUserSchema = z.object({
  regno: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  role: roleSchema,
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
  departmentId: z.string().trim().nullish(),
})

/** GET /api/admin/users — list users in the caller's college. */
export async function GET(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response

  // Tier 3: never an unscoped findMany.
  const users = await prisma.user.findMany({
    where: { ...scopes.college(result.ctx) },
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

  return NextResponse.json({ users })
}

/** POST /api/admin/users — create a user (admin controls who can log in). */
export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response

  const body = await req.json().catch(() => null)
  const parsed = createUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const { regno, name, email, role, password, departmentId } = parsed.data
  const regnoUpper = regno.toUpperCase()
  const emailLower = email.toLowerCase()

  const existing = await prisma.user.findFirst({
    where: { OR: [{ regno: regnoUpper }, { email: emailLower }] },
    select: { regno: true, email: true },
  })
  if (existing) {
    const field = existing.regno === regnoUpper ? 'Registration number' : 'Email'
    await audit({
      ctx: result.ctx,
      agentName: 'admin',
      actionType: 'USER_CREATE',
      targetEntity: 'User',
      status: 'REJECTED',
      after: { regno: regnoUpper, email: emailLower, reason: `${field} already in use` },
    })
    return NextResponse.json({ error: `${field} is already in use` }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const user = await prisma.user.create({
    data: {
      regno: regnoUpper,
      name,
      email: emailLower,
      role,
      passwordHash,
      collegeId: result.ctx.user.collegeId,
      departmentId: departmentId || null,
      status: 'ACTIVE',
    },
    select: { id: true, regno: true, name: true, email: true, role: true, status: true },
  })

  await audit({
    ctx: result.ctx,
    agentName: 'admin',
    actionType: 'USER_CREATE',
    targetEntity: 'User',
    entityId: user.id,
    after: { regno: user.regno, name: user.name, email: user.email, role: user.role },
  })

  return NextResponse.json({ user }, { status: 201 })
}
