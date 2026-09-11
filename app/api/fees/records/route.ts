import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { feeStatusFor } from '@/lib/fees'
import { FEE_RECORD_SELECT, feeRecordScope } from '@/lib/fees-query'

/**
 * Fee records — the "who owes what" half of Finance (Phase 3, doc §7).
 *
 * Students can read but never write: a payment is a finance-officer action,
 * and there is no payment gateway here to reconcile against.
 */

const createSchema = z.object({
  studentId: z.string().trim().min(1, 'studentId is required'),
  feeStructureId: z.string().trim().min(1, 'feeStructureId is required'),
  amountPaid: z.number().min(0).max(100_000_000).optional(),
  transactionRef: z.string().trim().max(120).nullish(),
  waiverReason: z.string().trim().max(400).nullish(),
})

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const scope = feeRecordScope(ctx)
  if (!scope) return NextResponse.json({ error: 'Forbidden: no fee access' }, { status: 403 })

  const studentId = req.nextUrl.searchParams.get('studentId')
  const status = req.nextUrl.searchParams.get('status')
  const canManage = ctx.can(PERMISSIONS.FEE_MANAGE)

  const records = await prisma.feeRecord.findMany({
    where: {
      ...scope,
      // A student must not widen their own scope by passing someone else's id.
      ...(studentId && canManage ? { studentId } : {}),
    },
    select: FEE_RECORD_SELECT,
    orderBy: { feeStructure: { dueDate: 'asc' } },
    take: 500,
  })

  // `status` is derived, never stored truth — filter after computing it.
  const filtered = status
    ? records.filter(
        (r) =>
          feeStatusFor({
            amountDue: r.feeStructure.amount,
            amountPaid: r.amountPaid,
            dueDate: r.feeStructure.dueDate,
            waived: Boolean(r.waiverReason),
          }) === status
      )
    : records

  return NextResponse.json({ records: filtered })
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

  // Both ends must belong to this college — otherwise a finance officer could
  // bill a student from another tenant onto their own structure.
  const [student, structure] = await Promise.all([
    prisma.user.findFirst({
      where: { id: parsed.data.studentId, ...scopes.college(ctx), role: 'STUDENT' },
      select: { id: true, name: true, regno: true },
    }),
    prisma.feeStructure.findFirst({
      where: { id: parsed.data.feeStructureId, ...scopes.college(ctx) },
      select: { id: true, amount: true, programName: true, dueDate: true },
    }),
  ])

  if (!student || !structure) {
    await audit({
      ctx,
      agentName: 'finance',
      actionType: 'FEE_RECORD_CREATE',
      targetEntity: 'FeeRecord',
      status: 'REJECTED',
      after: {
        reason: !student ? 'student not found' : 'fee structure not found',
        studentId: parsed.data.studentId,
        feeStructureId: parsed.data.feeStructureId,
      },
    })
    return NextResponse.json(
      { error: !student ? 'Student not found in your college' : 'Fee structure not found' },
      { status: 404 }
    )
  }

  const duplicate = await prisma.feeRecord.findUnique({
    where: { studentId_feeStructureId: { studentId: student.id, feeStructureId: structure.id } },
    select: { id: true },
  })
  if (duplicate) {
    return NextResponse.json(
      { error: 'This student is already billed under that fee structure' },
      { status: 409 }
    )
  }

  const openingPayment = parsed.data.amountPaid ?? 0
  if (openingPayment > structure.amount) {
    return NextResponse.json(
      { error: `amountPaid cannot exceed the billed amount (${structure.amount})` },
      { status: 400 }
    )
  }

  const now = new Date()
  const nextStatus = feeStatusFor({
    amountDue: structure.amount,
    amountPaid: openingPayment,
    dueDate: structure.dueDate,
    waived: Boolean(parsed.data.waiverReason),
  })

  const record = await prisma.feeRecord.create({
    data: {
      collegeId: ctx.user.collegeId,
      studentId: student.id,
      feeStructureId: structure.id,
      amountPaid: openingPayment,
      paymentDate: openingPayment > 0 ? now : null,
      transactionRef: parsed.data.transactionRef || null,
      waiverReason: parsed.data.waiverReason || null,
      status: nextStatus,
      // An opening balance is a real installment, not a silent cache write.
      ...(openingPayment > 0 && {
        payments: {
          create: {
            collegeId: ctx.user.collegeId,
            amount: openingPayment,
            paidAt: now,
            transactionRef: parsed.data.transactionRef || null,
            method: 'CASH',
            receivedById: ctx.user.id,
          },
        },
      }),
    },
    select: FEE_RECORD_SELECT,
  })

  await audit({
    ctx,
    agentName: 'finance',
    actionType: 'FEE_RECORD_CREATE',
    targetEntity: 'FeeRecord',
    entityId: record.id,
    after: {
      student: student.regno,
      structure: structure.programName,
      amountDue: structure.amount,
      amountPaid: openingPayment,
      status: nextStatus,
    },
  })

  return NextResponse.json({ record }, { status: 201 })
}
