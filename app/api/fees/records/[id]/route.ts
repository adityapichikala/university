import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes, type AuthContext } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { feeStatusFor, round2 } from '@/lib/fees'
import { FEE_RECORD_SELECT, feeRecordScope } from '@/lib/fees-query'

/**
 * One fee record: read it, post installments against it, waive it, delete it.
 *
 * The status column is a cache. Every write recomputes it from
 * `amountPaid` vs `feeStructure.amount`, so it can never drift.
 */

type Ctx = { params: Promise<{ id: string }> }

const updateSchema = z
  .object({
    /** Post an installment. Adds to amountPaid; never replaces it. */
    amount: z.number().positive().max(100_000_000).optional(),
    transactionRef: z.string().trim().max(120).nullish(),
    method: z.enum(['CASH', 'CARD', 'UPI', 'NETBANKING', 'CHEQUE']).optional(),
    /** Set to waive; pass "" to clear a waiver. */
    waiverReason: z.string().trim().max(400).nullish(),
  })
  .refine(
    (v) => v.amount !== undefined || v.waiverReason !== undefined || v.transactionRef !== undefined,
    { message: 'Provide at least one of: amount, waiverReason, transactionRef' }
  )

/** Resolve a record through the caller's Tier-3 scope. */
async function loadRecord(id: string, ctx: AuthContext, requireManage = false) {
  const scope = requireManage ? scopes.college(ctx) : feeRecordScope(ctx)
  if (!scope) return null
  return prisma.feeRecord.findFirst({ where: { id, ...scope }, select: FEE_RECORD_SELECT })
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const record = await loadRecord(id, ctx)
  if (!record) return NextResponse.json({ error: 'Fee record not found' }, { status: 404 })

  return NextResponse.json({ record })
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

  const existing = await loadRecord(id, ctx, true)
  if (!existing) {
    await audit({
      ctx,
      agentName: 'finance',
      actionType: 'FEE_RECORD_UPDATE',
      targetEntity: 'FeeRecord',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Fee record not found' }, { status: 404 })
  }

  const amountDue = existing.feeStructure.amount
  const before = { amountPaid: existing.amountPaid, status: existing.status }

  // ── Waiver ───────────────────────────────────────────────────────────────
  // A waiver is its own branch: it settles the record without money moving.
  if (parsed.data.waiverReason !== undefined) {
    const waiverReason = parsed.data.waiverReason || null
    const status = feeStatusFor({
      amountDue,
      amountPaid: existing.amountPaid,
      dueDate: existing.feeStructure.dueDate,
      waived: Boolean(waiverReason),
    })

    const record = await prisma.feeRecord.update({
      where: { id },
      data: { waiverReason, status },
      select: FEE_RECORD_SELECT,
    })

    await audit({
      ctx,
      agentName: 'finance',
      actionType: waiverReason ? 'FEE_WAIVE' : 'FEE_WAIVE_CLEAR',
      targetEntity: 'FeeRecord',
      entityId: id,
      before,
      after: { waiverReason, status, student: existing.student.regno },
    })

    return NextResponse.json({ record })
  }

  // ── Installment ──────────────────────────────────────────────────────────
  if (parsed.data.amount === undefined) {
    // Only transactionRef was sent: a metadata correction, no money involved.
    const record = await prisma.feeRecord.update({
      where: { id },
      data: { transactionRef: parsed.data.transactionRef ?? null },
      select: FEE_RECORD_SELECT,
    })
    await audit({
      ctx,
      agentName: 'finance',
      actionType: 'FEE_RECORD_UPDATE',
      targetEntity: 'FeeRecord',
      entityId: id,
      before: { transactionRef: existing.transactionRef },
      after: { transactionRef: record.transactionRef },
    })
    return NextResponse.json({ record })
  }

  if (existing.waiverReason) {
    return NextResponse.json(
      { error: 'This fee is waived — clear the waiver before collecting payment' },
      { status: 409 }
    )
  }

  const newPaid = round2(existing.amountPaid + parsed.data.amount)
  if (newPaid > amountDue + 0.005) {
    const outstanding = round2(Math.max(0, amountDue - existing.amountPaid))
    return NextResponse.json(
      {
        error: `Payment of ${parsed.data.amount} exceeds the outstanding balance of ${outstanding}`,
      },
      { status: 400 }
    )
  }

  const now = new Date()
  const status = feeStatusFor({
    amountDue,
    amountPaid: newPaid,
    dueDate: existing.feeStructure.dueDate,
    waived: false,
  })

  // Payment row + cached total in one transaction, so the ledger and the
  // headline number can never disagree.
  const record = await prisma.$transaction(async (tx) => {
    await tx.feePayment.create({
      data: {
        collegeId: ctx.user.collegeId!,
        feeRecordId: id,
        amount: parsed.data.amount!,
        paidAt: now,
        transactionRef: parsed.data.transactionRef || null,
        method: parsed.data.method ?? 'CASH',
        receivedById: ctx.user.id,
      },
    })
    return tx.feeRecord.update({
      where: { id },
      data: {
        amountPaid: newPaid,
        paymentDate: now,
        status,
        ...(parsed.data.transactionRef !== undefined && {
          transactionRef: parsed.data.transactionRef || null,
        }),
      },
      select: FEE_RECORD_SELECT,
    })
  })

  await audit({
    ctx,
    agentName: 'finance',
    actionType: 'FEE_PAYMENT',
    targetEntity: 'FeeRecord',
    entityId: id,
    before,
    after: {
      amountPaid: newPaid,
      status,
      installment: parsed.data.amount,
      method: parsed.data.method ?? 'CASH',
      student: existing.student.regno,
    },
  })

  return NextResponse.json({ record })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.FEE_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const existing = await loadRecord(id, ctx, true)
  if (!existing) {
    await audit({
      ctx,
      agentName: 'finance',
      actionType: 'FEE_RECORD_DELETE',
      targetEntity: 'FeeRecord',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Fee record not found' }, { status: 404 })
  }

  // Money already collected cannot silently vanish with the record.
  if (existing.payments.length > 0) {
    await audit({
      ctx,
      agentName: 'finance',
      actionType: 'FEE_RECORD_DELETE',
      targetEntity: 'FeeRecord',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'payments exist', payments: existing.payments.length },
    })
    return NextResponse.json(
      {
        error: `Cannot delete: ${existing.payments.length} payment(s) are recorded against this fee. Waive it instead.`,
      },
      { status: 409 }
    )
  }

  await prisma.feeRecord.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'finance',
    actionType: 'FEE_RECORD_DELETE',
    targetEntity: 'FeeRecord',
    entityId: id,
    before: {
      student: existing.student.regno,
      structure: existing.feeStructure.programName,
      amountDue: existing.feeStructure.amount,
    },
  })

  return NextResponse.json({ ok: true })
}
