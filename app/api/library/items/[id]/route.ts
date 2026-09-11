import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { stockIsSane } from '@/lib/library'

type Ctx = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  author: z.string().trim().min(1).max(160).optional(),
  isbn: z.string().trim().max(32).nullish(),
  /**
   * New physical total. `availableCopies` is adjusted by the same delta so a
   * librarian does not have to do the arithmetic by hand.
   */
  totalCopies: z.number().int().min(0).max(1000).optional(),
})

const select = {
  id: true,
  title: true,
  author: true,
  isbn: true,
  totalCopies: true,
  availableCopies: true,
} as const

export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const item = await prisma.libraryItem.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: {
      ...select,
      issues: {
        where: { returnedAt: null },
        select: {
          id: true,
          dueAt: true,
          student: { select: { id: true, name: true, regno: true } },
        },
        orderBy: { dueAt: 'asc' },
      },
    },
  })
  if (!item) return NextResponse.json({ error: 'Catalog item not found' }, { status: 404 })

  return NextResponse.json({ item })
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

  const existing = await prisma.libraryItem.findFirst({
    where: { id, ...scopes.college(ctx) },
    select,
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'library',
      actionType: 'LIBRARY_ITEM_UPDATE',
      targetEntity: 'LibraryItem',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Catalog item not found' }, { status: 404 })
  }

  let totalCopies = existing.totalCopies
  let availableCopies = existing.availableCopies

  if (parsed.data.totalCopies !== undefined && parsed.data.totalCopies !== existing.totalCopies) {
    const delta = parsed.data.totalCopies - existing.totalCopies
    totalCopies = parsed.data.totalCopies
    availableCopies = availableCopies + delta

    // Shrinking a catalog entry below the number of books currently on loan
    // would make `availableCopies` negative — the maths stops meaning anything.
    const onLoan = await prisma.libraryIssue.count({ where: { itemId: id, returnedAt: null } })
    if (totalCopies < onLoan) {
      await audit({
        ctx,
        agentName: 'library',
        actionType: 'LIBRARY_ITEM_UPDATE',
        targetEntity: 'LibraryItem',
        entityId: id,
        status: 'REJECTED',
        after: { reason: 'total below copies on loan', requested: totalCopies, onLoan },
      })
      return NextResponse.json(
        { error: `Cannot set total to ${totalCopies}: ${onLoan} cop(y/ies) are currently on loan` },
        { status: 409 }
      )
    }
    if (availableCopies < 0) availableCopies = 0
  }

  const isbn = parsed.data.isbn === undefined ? existing.isbn : parsed.data.isbn || null
  if (isbn && isbn !== existing.isbn) {
    const clash = await prisma.libraryItem.findUnique({ where: { isbn }, select: { id: true } })
    if (clash) {
      return NextResponse.json({ error: `ISBN ${isbn} already exists in the catalog` }, { status: 409 })
    }
  }

  const item = await prisma.libraryItem.update({
    where: { id },
    data: {
      title: parsed.data.title ?? existing.title,
      author: parsed.data.author ?? existing.author,
      isbn,
      totalCopies,
      availableCopies,
    },
    select,
  })

  if (!stockIsSane(item)) {
    return NextResponse.json(
      { error: 'Update rejected: it would leave the copy counts inconsistent' },
      { status: 409 }
    )
  }

  await audit({
    ctx,
    agentName: 'library',
    actionType: 'LIBRARY_ITEM_UPDATE',
    targetEntity: 'LibraryItem',
    entityId: id,
    before: {
      title: existing.title,
      totalCopies: existing.totalCopies,
      availableCopies: existing.availableCopies,
    },
    after: { title: item.title, totalCopies: item.totalCopies, availableCopies: item.availableCopies },
  })

  return NextResponse.json({ item })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.LIBRARY_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const existing = await prisma.libraryItem.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: {
      id: true,
      title: true,
      _count: { select: { issues: { where: { returnedAt: null } } } },
    },
  })
  if (!existing) {
    await audit({
      ctx,
      agentName: 'library',
      actionType: 'LIBRARY_ITEM_DELETE',
      targetEntity: 'LibraryItem',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'not found in your college' },
    })
    return NextResponse.json({ error: 'Catalog item not found' }, { status: 404 })
  }

  if (existing._count.issues > 0) {
    await audit({
      ctx,
      agentName: 'library',
      actionType: 'LIBRARY_ITEM_DELETE',
      targetEntity: 'LibraryItem',
      entityId: id,
      status: 'REJECTED',
      after: { reason: 'copies on loan', onLoan: existing._count.issues },
    })
    return NextResponse.json(
      { error: `Cannot delete: ${existing._count.issues} cop(y/ies) are still on loan` },
      { status: 409 }
    )
  }

  await prisma.libraryItem.delete({ where: { id } })

  await audit({
    ctx,
    agentName: 'library',
    actionType: 'LIBRARY_ITEM_DELETE',
    targetEntity: 'LibraryItem',
    entityId: id,
    before: { title: existing.title },
  })

  return NextResponse.json({ ok: true })
}
