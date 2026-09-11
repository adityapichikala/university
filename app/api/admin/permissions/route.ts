import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'

/** GET /api/admin/permissions?userId=… — catalogue + that user's overrides. */
export async function GET(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response

  const userId = req.nextUrl.searchParams.get('userId')

  const permissions = await prisma.permission.findMany({
    orderBy: { key: 'asc' },
    select: { id: true, key: true, description: true },
  })

  if (!userId) return NextResponse.json({ permissions, overrides: {} })

  const overrides = await prisma.userPermission.findMany({
    where: { userId },
    select: { granted: true, permission: { select: { key: true } } },
  })

  return NextResponse.json({
    permissions,
    overrides: Object.fromEntries(overrides.map((o) => [o.permission.key, o.granted])),
  })
}

const setOverrideSchema = z.object({
  userId: z.string().min(1),
  key: z.string().min(1),
  /** true = force grant, false = force revoke, null = fall back to role default. */
  granted: z.boolean().nullable(),
})

/** PUT /api/admin/permissions — Tier-2 per-user grant/revoke (overrides the role). */
export async function PUT(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response

  const body = await req.json().catch(() => null)
  const parsed = setOverrideSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
  }

  const { userId, key, granted } = parsed.data

  // Tier 3: target user must be in the caller's college.
  const target = await prisma.user.findFirst({
    where: { id: userId, ...scopes.college(result.ctx) },
    select: { id: true, regno: true, role: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const permission = await prisma.permission.findUnique({ where: { key } })
  if (!permission) return NextResponse.json({ error: 'Unknown permission' }, { status: 400 })

  // Snapshot for the audit trail — what the override is replacing.
  const previous = await prisma.userPermission.findUnique({
    where: { userId_permissionId: { userId, permissionId: permission.id } },
    select: { granted: true },
  })

  if (granted === null) {
    await prisma.userPermission.deleteMany({ where: { userId, permissionId: permission.id } })
  } else {
    await prisma.userPermission.upsert({
      where: { userId_permissionId: { userId, permissionId: permission.id } },
      update: { granted },
      create: { userId, permissionId: permission.id, granted },
    })
  }

  await audit({
    ctx: result.ctx,
    agentName: 'admin',
    actionType: 'PERMISSION_OVERRIDE_SET',
    targetEntity: 'UserPermission',
    entityId: `${userId}:${permission.id}`,
    before: { userId, permission: key, granted: previous?.granted ?? null },
    after: {
      userId,
      regno: target.regno,
      role: target.role,
      permission: key,
      granted,
    },
  })

  return NextResponse.json({ ok: true })
}
