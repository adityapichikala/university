import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

/**
 * Fee structures — the "what is owed" half of Finance (Phase 3, doc §7).
 *
 * A structure is a template (program + batch → amount + due date); a
 * `FeeRecord` is that template applied to one student. Structures are
 * college-wide and readable by any authenticated member of the college,
 * but only `fee.manage` may create or change them.
 */

const createSchema = z.object({
  programName: z.string().trim().min(1).max(120),
  batchYear: z.number().int().min(1950).max(2100),
  amount: z.number().positive().max(100_000_000),
  dueDate: z.string().trim().min(1, 'dueDate is required'),
})

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const structures = await prisma.feeStructure.findMany({
    where: scopes.college(ctx),
    select: {
      id: true,
      programName: true,
      batchYear: true,
      amount: true,
      dueDate: true,
      _count: { select: { feeRecords: true } },
    },
    orderBy: [{ batchYear: 'desc' }, { programName: 'asc' }],
    take: 200,
  })

  return NextResponse.json({ structures })
}

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.FEE_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const dueDate = parseDate(parsed.data.dueDate)
  if (!dueDate) {
    return NextResponse.json({ error: 'dueDate must be YYYY-MM-DD or an ISO datetime' }, { status: 400 })
  }

  const structure = await prisma.feeStructure.create({
    data: {
      collegeId: ctx.user.collegeId,
      programName: parsed.data.programName,
      batchYear: parsed.data.batchYear,
      amount: parsed.data.amount,
      dueDate,
    },
    select: { id: true, programName: true, batchYear: true, amount: true, dueDate: true },
  })

  await audit({
    ctx,
    agentName: 'finance',
    actionType: 'FEE_STRUCTURE_CREATE',
    targetEntity: 'FeeStructure',
    entityId: structure.id,
    after: {
      programName: structure.programName,
      batchYear: structure.batchYear,
      amount: structure.amount,
      dueDate: dueDate.toISOString(),
    },
  })

  return NextResponse.json({ structure }, { status: 201 })
}

/** Accepts "YYYY-MM-DD" or any ISO datetime. */
function parseDate(value: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.000Z`)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
