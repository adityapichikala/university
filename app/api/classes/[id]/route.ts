import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

const updateClassSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  departmentId: z.string().min(1).optional(),
  semester: z.number().int().min(1).max(12).optional(),
  batchYear: z.number().int().min(2000).max(2100).optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.CLASS_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  const collegeId = ctx.user.collegeId
  if (!collegeId) return NextResponse.json({ error: 'No college scope' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = updateClassSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const target = await prisma.class.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: { id: true, name: true, semester: true, batchYear: true, departmentId: true },
  })
  if (!target) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

  const { name, departmentId, semester, batchYear } = parsed.data

  if (departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: departmentId, collegeId },
      select: { id: true },
    })
    if (!department) {
      return NextResponse.json({ error: 'Department not found in your college' }, { status: 400 })
    }
  }

  if (name && name !== target.name) {
    const duplicate = await prisma.class.findUnique({
      where: { collegeId_name: { collegeId, name } },
      select: { id: true },
    })
    if (duplicate) {
      await audit({
        ctx,
        agentName: 'academics',
        actionType: 'CLASS_UPDATE',
        targetEntity: 'Class',
        entityId: id,
        status: 'REJECTED',
        after: { name, reason: 'name already used in this college' },
      })
      return NextResponse.json({ error: `Class ${name} already exists` }, { status: 409 })
    }
  }

  const klass = await prisma.class.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(departmentId !== undefined && { departmentId }),
      ...(semester !== undefined && { semester }),
      ...(batchYear !== undefined && { batchYear }),
    },
    select: { id: true, name: true, semester: true, batchYear: true, departmentId: true },
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'CLASS_UPDATE',
    targetEntity: 'Class',
    entityId: id,
    before: target,
    after: {
      name: klass.name,
      semester: klass.semester,
      batchYear: klass.batchYear,
      departmentId: klass.departmentId,
    },
  })

  return NextResponse.json({ class: klass })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.CLASS_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const target = await prisma.class.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: { id: true, name: true, _count: { select: { enrollments: true } } },
  })
  if (!target) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

  if (target._count.enrollments > 0) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'CLASS_DELETE',
      targetEntity: 'Class',
      entityId: id,
      status: 'REJECTED',
      after: { name: target.name, reason: 'class still has enrollments' },
    })
    return NextResponse.json(
      { error: `Cannot delete ${target.name}: ${target._count.enrollments} enrollment(s)` },
      { status: 409 }
    )
  }

  await prisma.class.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'CLASS_DELETE',
    targetEntity: 'Class',
    entityId: id,
    before: { name: target.name },
  })

  return NextResponse.json({ ok: true })
}
