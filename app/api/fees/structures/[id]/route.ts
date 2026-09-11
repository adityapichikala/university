import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

type Ctx = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  programName: z.string().trim().min(1).max(120).optional(),
  batchYear: z.number().int().min(1950).max(2100).optional(),
  amount: z.number().positive().max(100_000_000).optional(),
  dueDate: z.string().trim().min(1).optional(),
})

const select = {
  id: true,
  programName: true,
  batchYear: true,
  amount: true,
  dueDate: true,
} as const

export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const structure = await prisma.feeStructure.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: { ...select, _count: { select: { feeRecords: true } } },
  })
  if (!structure) return NextResponse.json({ error: 'Fee structure not found' }, { status: 404 })

  return NextResponse.json({ structure })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.FEE_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const existing = await prisma.feeStructure.findFirst({
    where: { id, ...scopes.college(ctx) },
    select,
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'finance',
      actionType: 'FEE_STRUCTURE_UPDATE',
      targetEntity: 'FeeStructure',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Fee structure not found' }, { status: 404 })
  }

  let dueDate: Date | undefined
  if (parsed.data.dueDate !== undefined) {
    dueDate = parseDate(parsed.data.dueDate) ?? undefined
    if (!dueDate) {
      return NextResponse.json(
        { error: 'dueDate must be YYYY-MM-DD or an ISO datetime' },
        { status: 400 }
      )
    }
  }

  const structure = await prisma.feeStructure.update({
    where: { id },
    data: {
      ...(parsed.data.programName !== undefined && { programName: parsed.data.programName }),
      ...(parsed.data.batchYear !== undefined && { batchYear: parsed.data.batchYear }),
      ...(parsed.data.amount !== undefined && { amount: parsed.data.amount }),
      ...(dueDate && { dueDate }),
    },
    select,
  })

  await audit({
    ctx,
    agentName: 'finance',
    actionType: 'FEE_STRUCTURE_UPDATE',
    targetEntity: 'FeeStructure',
    entityId: id,
    before: { amount: existing.amount, dueDate: existing.dueDate.toISOString() },
    after: { amount: structure.amount, dueDate: structure.dueDate.toISOString() },
  })

  return NextResponse.json({ structure })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.FEE_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const existing = await prisma.feeStructure.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: { id: true, programName: true, _count: { select: { feeRecords: true } } },
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'finance',
      actionType: 'FEE_STRUCTURE_DELETE',
      targetEntity: 'FeeStructure',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Fee structure not found' }, { status: 404 })
  }

  // Deleting a template that students have already been billed against would
  // orphan their FeeRecords — refuse instead of cascading away money history.
  if (existing._count.feeRecords > 0) {
    await audit({
      ctx,
      agentName: 'finance',
      actionType: 'FEE_STRUCTURE_DELETE',
      targetEntity: 'FeeStructure',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'records exist', feeRecords: existing._count.feeRecords },
    })
    return NextResponse.json(
      {
        error: `Cannot delete: ${existing._count.feeRecords} fee record(s) reference this structure`,
      },
      { status: 409 }
    )
  }

  await prisma.feeStructure.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'finance',
    actionType: 'FEE_STRUCTURE_DELETE',
    targetEntity: 'FeeStructure',
    entityId: id,
    before: { programName: existing.programName },
  })

  return NextResponse.json({ ok: true })
}

/** Accepts "YYYY-MM-DD" or any ISO datetime. */
function parseDate(value: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.000Z`)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
