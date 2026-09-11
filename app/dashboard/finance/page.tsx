import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { feeStatusFor, formatCurrency, summarizeFees } from '@/lib/fees'
import { FEE_RECORD_SELECT } from '@/lib/fees-query'
import { ToastProvider } from '@/components/ui/toast'
import { FinanceWorkspace } from './FinanceWorkspace'

export const metadata = { title: 'Finance · Apex University ERP' }

/**
 * Finance officer portal (Phase 3, doc §7).
 *
 * Guarded by `fee.manage` — Tier 2 decides who can open the screen at all,
 * and the API re-checks the same permission on every write.
 */
export default async function FinancePage() {
  const ctx = await requirePermission(PERMISSIONS.FEE_MANAGE, { route: 'finance' })

  const [records, structures, students] = await Promise.all([
    prisma.feeRecord.findMany({
      where: scopes.college(ctx),
      select: FEE_RECORD_SELECT,
      orderBy: { feeStructure: { dueDate: 'asc' } },
      take: 300,
    }),
    prisma.feeStructure.findMany({
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
    }),
    prisma.user.findMany({
      where: { ...scopes.college(ctx), role: 'STUDENT' },
      select: { id: true, name: true, regno: true },
      orderBy: { regno: 'asc' },
    }),
  ])

  const rows = records.map((r) => ({
    id: r.id,
    studentId: r.student.id,
    studentName: r.student.name,
    studentRegno: r.student.regno,
    structureId: r.feeStructure.id,
    structureName: r.feeStructure.programName,
    dueDate: r.feeStructure.dueDate.toISOString().slice(0, 10),
    amountDue: r.feeStructure.amount,
    amountPaid: r.amountPaid,
    outstanding: Math.max(0, r.feeStructure.amount - r.amountPaid),
    waiverReason: r.waiverReason,
    status: feeStatusFor({
      amountDue: r.feeStructure.amount,
      amountPaid: r.amountPaid,
      dueDate: r.feeStructure.dueDate,
      waived: Boolean(r.waiverReason),
    }),
    payments: r.payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      paidAt: p.paidAt.toISOString().slice(0, 10),
      method: p.method,
      transactionRef: p.transactionRef,
    })),
  }))

  const summary = summarizeFees(
    records.map((r) => ({
      amountDue: r.feeStructure.amount,
      amountPaid: r.amountPaid,
      status: r.status,
      dueDate: r.feeStructure.dueDate,
      waived: Boolean(r.waiverReason),
    }))
  )

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Finance</h1>
        <p className="mt-1 text-sm text-muted">
          Fee structures, student billing and installment collection. Every payment is written to
          the audit log.
        </p>
      </div>

      <ToastProvider>
        <FinanceWorkspace
          summary={{
            billed: summary.billed,
            paid: summary.paid,
            outstanding: summary.outstanding,
            overdueCount: summary.overdueCount,
            billedLabel: formatCurrency(summary.billed),
            paidLabel: formatCurrency(summary.paid),
            outstandingLabel: formatCurrency(summary.outstanding),
          }}
          records={rows}
          structures={structures.map((s) => ({
            id: s.id,
            programName: s.programName,
            batchYear: s.batchYear,
            amount: s.amount,
            dueDate: s.dueDate.toISOString().slice(0, 10),
            recordCount: s._count.feeRecords,
          }))}
          students={students}
        />
      </ToastProvider>
    </div>
  )
}
