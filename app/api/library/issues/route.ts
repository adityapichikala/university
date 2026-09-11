import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { canIssue, defaultDueDate } from '@/lib/library'
import { LIBRARY_ISSUE_SELECT, libraryIssueScope } from '@/lib/library-query'

/**
 * Library issues — the borrow/return desk (Phase 3, doc §7).
 *
 * Issuing is a librarian action: `availableCopies` is inventory and must only
 * move under `library.manage`. Anyone in the college may read — scoped to
 * their own loans unless they hold `library.manage`.
 */

const createSchema = z.object({
  itemId: z.string().trim().min(1, 'itemId is required'),
  studentId: z.string().trim().min(1, 'studentId is required'),
  /** Optional; defaults to today + 14 days. */
  dueAt: z.string().trim().optional(),
})

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const status = req.nextUrl.searchParams.get('status')
  const studentId = req.nextUrl.searchParams.get('studentId')
  const canManage = ctx.can(PERMISSIONS.LIBRARY_MANAGE)

  const now = new Date()
  const rows = await prisma.libraryIssue.findMany({
    where: {
      ...libraryIssueScope(ctx),
      // Only a librarian may pivot to another student's loans.
      ...(studentId && canManage ? { studentId } : {}),
      ...(status === 'ACTIVE' && { returnedAt: null, dueAt: { gte: now } }),
      ...(status === 'OVERDUE' && { returnedAt: null, dueAt: { lt: now } }),
      ...(status === 'RETURNED' && { returnedAt: { not: null } }),
    },
    select: LIBRARY_ISSUE_SELECT,
    orderBy: [{ returnedAt: 'asc' }, { dueAt: 'asc' }],
    take: 500,
  })

  return NextResponse.json({ issues: rows })
}

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.LIBRARY_MANAGE)
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

  const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : defaultDueDate()
  if (Number.isNaN(dueAt.getTime())) {
    return NextResponse.json({ error: 'dueAt must be an ISO date' }, { status: 400 })
  }

  const [item, student] = await Promise.all([
    prisma.libraryItem.findFirst({
      where: { id: parsed.data.itemId, ...scopes.college(ctx) },
      select: { id: true, title: true, totalCopies: true, availableCopies: true },
    }),
    prisma.user.findFirst({
      where: { id: parsed.data.studentId, ...scopes.college(ctx) },
      select: { id: true, name: true, regno: true },
    }),
  ])

  if (!item || !student) {
    await audit({
      ctx,
      agentName: 'library',
      actionType: 'LIBRARY_ISSUE',
      targetEntity: 'LibraryIssue',
      status: 'REJECTED',
      after: {
        reason: !item ? 'catalog item not found' : 'student not found',
        itemId: parsed.data.itemId,
        studentId: parsed.data.studentId,
      },
    })
    return NextResponse.json(
      { error: !item ? 'Catalog item not found' : 'Student not found in your college' },
      { status: 404 }
    )
  }

  const stock = canIssue(item)
  if (!stock.ok) {
    await audit({
      ctx,
      agentName: 'library',
      actionType: 'LIBRARY_ISSUE',
      targetEntity: 'LibraryIssue',
      status: 'REJECTED',
      after: { reason: stock.reason, item: item.title, student: student.regno },
    })
    return NextResponse.json({ error: stock.reason }, { status: 409 })
  }

  // Decrement the shelf and open the loan together — a crash between the two
  // would otherwise hand out a copy that is no longer counted.
  const issue = await prisma.$transaction(async (tx) => {
    const updated = await tx.libraryItem.updateMany({
      where: { id: item.id, availableCopies: { gt: 0 } },
      data: { availableCopies: { decrement: 1 } },
    })
    if (updated.count === 0) throw new Error('COPY_RACE')

    return tx.libraryIssue.create({
      data: {
        collegeId: ctx.user.collegeId!,
        itemId: item.id,
        studentId: student.id,
        dueAt,
      },
      select: LIBRARY_ISSUE_SELECT,
    })
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === 'COPY_RACE') return null
    throw error
  })

  if (!issue) {
    return NextResponse.json(
      { error: 'That copy was just taken — no copies left' },
      { status: 409 }
    )
  }

  await audit({
    ctx,
    agentName: 'library',
    actionType: 'LIBRARY_ISSUE',
    targetEntity: 'LibraryIssue',
    entityId: issue.id,
    after: {
      item: item.title,
      student: student.regno,
      dueAt: dueAt.toISOString(),
      copiesLeft: item.availableCopies - 1,
    },
  })

  return NextResponse.json({ issue }, { status: 201 })
}
