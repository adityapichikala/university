import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { computeFine, FINE_PER_DAY } from '@/lib/library'
import { LIBRARY_ISSUE_SELECT } from '@/lib/library-query'

/**
 * One library loan: read it, return it (fine computed at the desk), or void it.
 *
 * The fine is charged up to the moment of return, not "now" — a book handed
 * back on Tuesday is not fined for Wednesday.
 */

type Ctx = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  /** Omit to use the current time. */
  returnedAt: z.string().trim().optional(),
  /** Override the auto-computed fine (e.g. waived by the librarian). */
  fineAmount: z.number().min(0).max(1_000_000).optional(),
  /** Per-day rate override; defaults to ₹5/day. */
  finePerDay: z.number().min(0).max(10_000).optional(),
})

export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const issue = await prisma.libraryIssue.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: LIBRARY_ISSUE_SELECT,
  })
  if (!issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 })

  // A student must not read another student's loan record.
  if (!ctx.can(PERMISSIONS.LIBRARY_MANAGE) && issue.student.id !== ctx.user.id) {
    return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
  }

  const fine = computeFine(issue.dueAt, issue.returnedAt, FINE_PER_DAY)
  return NextResponse.json({ issue, fine })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.LIBRARY_MANAGE)
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

  const existing = await prisma.libraryIssue.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: LIBRARY_ISSUE_SELECT,
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'library',
      actionType: 'LIBRARY_RETURN',
      targetEntity: 'LibraryIssue',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
  }

  if (existing.returnedAt) {
    return NextResponse.json(
      { error: 'This copy was already returned' },
      { status: 409 }
    )
  }

  const returnedAt = parsed.data.returnedAt ? new Date(parsed.data.returnedAt) : new Date()
  if (Number.isNaN(returnedAt.getTime())) {
    return NextResponse.json({ error: 'returnedAt must be an ISO date' }, { status: 400 })
  }
  if (returnedAt.getTime() < existing.issuedAt.getTime()) {
    return NextResponse.json(
      { error: 'returnedAt cannot be before the issue date' },
      { status: 400 }
    )
  }

  const fine =
    parsed.data.fineAmount ??
    computeFine(existing.dueAt, returnedAt, parsed.data.finePerDay ?? FINE_PER_DAY)

  // Return the copy to the shelf and close the loan in one transaction.
  const issue = await prisma.$transaction(async (tx) => {
    const updated = await tx.libraryIssue.updateMany({
      where: { id, returnedAt: null },
      data: { returnedAt, fineAmount: fine },
    })
    if (updated.count === 0) throw new Error('ALREADY_RETURNED')

    await tx.libraryItem.update({
      where: { id: existing.item.id },
      data: { availableCopies: { increment: 1 } },
    })

    return tx.libraryIssue.findUnique({ where: { id }, select: LIBRARY_ISSUE_SELECT })
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === 'ALREADY_RETURNED') return null
    throw error
  })

  if (!issue) {
    return NextResponse.json({ error: 'This copy was already returned' }, { status: 409 })
  }

  await audit({
    ctx,
    agentName: 'library',
    actionType: 'LIBRARY_RETURN',
    targetEntity: 'LibraryIssue',
    entityId: id,
    before: { returnedAt: null, fineAmount: existing.fineAmount },
    after: {
      item: existing.item.title,
      student: existing.student.regno,
      returnedAt: returnedAt.toISOString(),
      fineAmount: fine,
      lateByDays: computeFine(existing.dueAt, returnedAt, 1),
    },
  })

  return NextResponse.json({ issue })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.LIBRARY_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const existing = await prisma.libraryIssue.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: LIBRARY_ISSUE_SELECT,
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'library',
      actionType: 'LIBRARY_ISSUE_DELETE',
      targetEntity: 'LibraryIssue',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
  }

  // Deleting a live loan would leak a copy off the shelf forever.
  if (!existing.returnedAt) {
    await audit({
      ctx,
      agentName: 'library',
      actionType: 'LIBRARY_ISSUE_DELETE',
      targetEntity: 'LibraryIssue',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'still on loan', item: existing.item.title },
    })
    return NextResponse.json(
      { error: 'Cannot delete a loan that is still out — return it first' },
      { status: 409 }
    )
  }

  await prisma.libraryIssue.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'library',
    actionType: 'LIBRARY_ISSUE_DELETE',
    targetEntity: 'LibraryIssue',
    entityId: id,
    before: { item: existing.item.title, student: existing.student.regno },
  })

  return NextResponse.json({ ok: true })
}
