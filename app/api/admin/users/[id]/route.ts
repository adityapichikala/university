import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS, isRole } from '@/lib/roles'

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.string().refine(isRole, 'Invalid role').optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  departmentId: z.string().trim().nullish(),
})

type Ctx = { params: Promise<{ id: string }> }

/** PATCH /api/admin/users/:id — change name, role or status. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response

  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = updateUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  // Tier 3: the target must live in the caller's college.
  const target = await prisma.user.findFirst({
    where: { id, ...scopes.college(result.ctx) },
    select: { id: true, regno: true, name: true, role: true, status: true, departmentId: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Guard rail: an admin must not lock themselves out.
  if (id === result.ctx.user.id && parsed.data.status === 'INACTIVE') {
    await audit({
      ctx: result.ctx,
      agentName: 'admin',
      actionType: 'USER_UPDATE',
      targetEntity: 'User',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'self deactivation blocked' },
    })
    return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 })
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.role !== undefined && { role: parsed.data.role }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.departmentId !== undefined && {
        departmentId: parsed.data.departmentId || null,
      }),
    },
    select: { id: true, regno: true, name: true, email: true, role: true, status: true },
  })

  await audit({
    ctx: result.ctx,
    agentName: 'admin',
    actionType: 'USER_UPDATE',
    targetEntity: 'User',
    entityId: user.id,
    before: {
      name: target.name,
      role: target.role,
      status: target.status,
      departmentId: target.departmentId,
    },
    after: {
      name: user.name,
      role: user.role,
      status: user.status,
      departmentId: parsed.data.departmentId ?? target.departmentId,
    },
  })

  return NextResponse.json({ user })
}

/** DELETE /api/admin/users/:id — deactivate (soft delete; keeps FK history intact). */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response

  const { id } = await params
  if (id === result.ctx.user.id) {
    await audit({
      ctx: result.ctx,
      agentName: 'admin',
      actionType: 'USER_DEACTIVATE',
      targetEntity: 'User',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'self deactivation blocked' },
    })
    return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 })
  }

  const target = await prisma.user.findFirst({
    where: { id, ...scopes.college(result.ctx) },
    select: { id: true, regno: true, role: true, status: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  await prisma.user.update({ where: { id }, data: { status: 'INACTIVE' } })

  await audit({
    ctx: result.ctx,
    agentName: 'admin',
    actionType: 'USER_DEACTIVATE',
    targetEntity: 'User',
    entityId: id,
    before: { status: target.status },
    after: { status: 'INACTIVE', regno: target.regno, role: target.role },
  })

  return NextResponse.json({ ok: true })
}
