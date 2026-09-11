import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

const classSelect = {
  id: true,
  name: true,
  semester: true,
  batchYear: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
  _count: { select: { enrollments: true } },
} as const

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const classes = await prisma.class.findMany({
    where: scopes.college(ctx),
    select: classSelect,
    orderBy: [{ batchYear: 'desc' }, { semester: 'asc' }, { name: 'asc' }],
  })

  return NextResponse.json({ classes })
}

const createClassSchema = z.object({
  name: z.string().trim().min(1).max(64),
  departmentId: z.string().min(1),
  semester: z.number().int().min(1).max(12),
  batchYear: z.number().int().min(2000).max(2100),
})

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.CLASS_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  const collegeId = ctx.user.collegeId
  if (!collegeId) return NextResponse.json({ error: 'No college scope' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = createClassSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const { name, departmentId, semester, batchYear } = parsed.data

  const department = await prisma.department.findFirst({
    where: { id: departmentId, collegeId },
    select: { id: true },
  })
  if (!department) {
    return NextResponse.json({ error: 'Department not found in your college' }, { status: 400 })
  }

  const duplicate = await prisma.class.findUnique({
    where: { collegeId_name: { collegeId, name } },
    select: { id: true },
  })
  if (duplicate) {
    await audit({
      ctx,
      agentName: 'academics',
      actionType: 'CLASS_CREATE',
      targetEntity: 'Class',
      status: 'REJECTED',
      after: { name, reason: 'name already used in this college' },
    })
    return NextResponse.json({ error: `Class ${name} already exists` }, { status: 409 })
  }

  const klass = await prisma.class.create({
    data: { name, departmentId, semester, batchYear, collegeId },
    select: classSelect,
  })

  await audit({
    ctx,
    agentName: 'academics',
    actionType: 'CLASS_CREATE',
    targetEntity: 'Class',
    entityId: klass.id,
    after: { name: klass.name, semester, batchYear, departmentId },
  })

  return NextResponse.json({ class: klass }, { status: 201 })
}
