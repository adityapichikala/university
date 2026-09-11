import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

/**
 * Library catalog (Phase 3, doc §7).
 *
 * The catalog is public within a college — anyone may browse it — but only
 * `library.manage` may add or change items, because `totalCopies` /
 * `availableCopies` are inventory and must not drift.
 */

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(160),
  isbn: z.string().trim().max(32).nullish(),
  totalCopies: z.number().int().min(1).max(1000),
})

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const search = req.nextUrl.searchParams.get('q')?.trim()
  const availableOnly = req.nextUrl.searchParams.get('available') === '1'

  const items = await prisma.libraryItem.findMany({
    where: {
      ...scopes.college(ctx),
      ...(search && {
        OR: [
          { title: { contains: search } },
          { author: { contains: search } },
          { isbn: { contains: search } },
        ],
      }),
      // SQLite + Prisma: `contains` is case-insensitive for ASCII by default
      // on SQLite only when the column is NOT using BINARY collation; we keep
      // it simple and rely on the UI to send lower-cased terms.
      ...(availableOnly && { availableCopies: { gt: 0 } }),
    },
    select: {
      id: true,
      title: true,
      author: true,
      isbn: true,
      totalCopies: true,
      availableCopies: true,
      _count: { select: { issues: true } },
    },
    orderBy: { title: 'asc' },
    take: 300,
  })

  return NextResponse.json({ items })
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

  const isbn = parsed.data.isbn || null
  if (isbn) {
    const clash = await prisma.libraryItem.findUnique({ where: { isbn }, select: { id: true } })
    if (clash) {
      return NextResponse.json({ error: `ISBN ${isbn} already exists in the catalog` }, { status: 409 })
    }
  }

  const item = await prisma.libraryItem.create({
    data: {
      collegeId: ctx.user.collegeId,
      title: parsed.data.title,
      author: parsed.data.author,
      isbn,
      totalCopies: parsed.data.totalCopies,
      availableCopies: parsed.data.totalCopies,
    },
    select: {
      id: true,
      title: true,
      author: true,
      isbn: true,
      totalCopies: true,
      availableCopies: true,
    },
  })

  await audit({
    ctx,
    agentName: 'library',
    actionType: 'LIBRARY_ITEM_CREATE',
    targetEntity: 'LibraryItem',
    entityId: item.id,
    after: { title: item.title, author: item.author, totalCopies: item.totalCopies },
  })

  return NextResponse.json({ item }, { status: 201 })
}
