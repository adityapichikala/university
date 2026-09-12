import { prisma } from '@/lib/db'
import { requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { computeFine, issueState } from '@/lib/library'
import { LIBRARY_ISSUE_SELECT } from '@/lib/library-query'
import { ToastProvider } from '@/components/ui/toast'
import { LibraryWorkspace } from './LibraryWorkspace'

export const metadata = { title: 'Library · Apex University ERP' }

/**
 * Librarian portal (Phase 3, doc §7).
 *
 * Guarded by `library.manage`. The desk can add stock, hand a copy out, and
 * take one back — the fine is computed by the API at the moment of return.
 */
export default async function LibrarianPage() {
  const ctx = await requirePermission(PERMISSIONS.LIBRARY_MANAGE, { route: 'librarian' })
  const now = new Date()

  const [items, issues, students] = await Promise.all([
    prisma.libraryItem.findMany({
      where: scopes.college(ctx),
      select: {
        id: true,
        title: true,
        author: true,
        isbn: true,
        totalCopies: true,
        availableCopies: true,
      },
      orderBy: { title: 'asc' },
      take: 300,
    }),
    prisma.libraryIssue.findMany({
      where: scopes.college(ctx),
      select: LIBRARY_ISSUE_SELECT,
      orderBy: [{ returnedAt: 'asc' }, { dueAt: 'asc' }],
      take: 300,
    }),
    prisma.user.findMany({
      where: { ...scopes.college(ctx), role: 'STUDENT' },
      select: { id: true, name: true, regno: true },
      orderBy: { regno: 'asc' },
    }),
  ])

  const rows = issues.map((i) => ({
    id: i.id,
    itemId: i.item.id,
    itemTitle: i.item.title,
    studentRegno: i.student.regno,
    studentName: i.student.name,
    issuedAt: i.issuedAt.toISOString().slice(0, 10),
    dueAt: i.dueAt.toISOString().slice(0, 10),
    returnedAt: i.returnedAt ? i.returnedAt.toISOString().slice(0, 10) : null,
    fineAmount: i.fineAmount,
    state: issueState({ returnedAt: i.returnedAt, dueAt: i.dueAt, now }),
    // Live loans accrue; the desk will charge this on return.
    projectedFine: i.returnedAt ? i.fineAmount : computeFine(i.dueAt, now),
  }))

  const onLoan = rows.filter((r) => r.state !== 'RETURNED')
  const finesCollected = rows
    .filter((r) => r.state === 'RETURNED')
    .reduce((sum, r) => sum + r.fineAmount, 0)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Library</h1>
        <p className="mt-1 text-sm text-muted">
          Catalog, loans and returns. Fines are charged at ₹5 per day, calculated when the book
          comes back.
        </p>
      </div>

      <ToastProvider>
        <LibraryWorkspace
          summary={{
            titles: items.length,
            onLoan: onLoan.length,
            overdue: rows.filter((r) => r.state === 'OVERDUE').length,
            finesCollected,
          }}
          items={items}
          issues={rows}
          students={students}
        />
      </ToastProvider>
    </div>
  )
}
