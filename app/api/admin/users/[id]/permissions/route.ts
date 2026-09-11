import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/roles'
import { setUserPermission } from '@/lib/permissions'

/**
 * PATCH /api/admin/users/:id/permissions
 *
 * The HTTP twin of the governance dashboard's server action — same core in
 * lib/permissions.ts, so a toggle in the browser and a curl call behave
 * identically (and both land in the audit chain).
 *
 *   body: { permissionKey: "grade.entry", granted: false }
 *   body: { permissions: [{ permissionKey: "lms.access", granted: true }, …] }
 */

const singleSchema = z.object({
  permissionKey: z.string().trim().min(1),
  granted: z.boolean(),
})

const payloadSchema = z.union([
  singleSchema,
  z.object({
    permissions: z.array(singleSchema).min(1).max(50),
  }),
])

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = payloadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const changes =
    'permissions' in parsed.data ? parsed.data.permissions : [parsed.data]

  // Tier 3: the target must live in the caller's college.
  const target = await prisma.user.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: { id: true, regno: true, name: true, role: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const applied: Array<{ permissionKey: string; granted: boolean; source: string }> = []

  for (const change of changes) {
    const outcome = await setUserPermission(ctx, {
      userId: id,
      permissionKey: change.permissionKey,
      granted: change.granted,
    })
    if (!outcome.ok) {
      // Partial failure: report what landed before the error.
      await audit({
        ctx,
        agentName: 'admin',
        actionType: 'PERMISSION_SET',
        targetEntity: 'UserPermission',
        entityId: `${target.regno}:${change.permissionKey}`,
        status: 'FAILED',
        after: { reason: outcome.error },
      })
      return NextResponse.json(
        { error: outcome.error, applied },
        { status: applied.length ? 207 : 400 }
      )
    }
    applied.push({
      permissionKey: change.permissionKey,
      granted: change.granted,
      source: outcome.data.source,
    })
  }

  return NextResponse.json({ user: { id: target.id, regno: target.regno }, permissions: applied })
}

/** GET — effective permission set for one user (role grants + overrides). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const target = await prisma.user.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: { id: true, regno: true, name: true, role: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const [roleGrants, overrides] = await Promise.all([
    prisma.rolePermission.findMany({
      where: { role: target.role },
      select: { permission: { select: { key: true } } },
    }),
    prisma.userPermission.findMany({
      where: { userId: id },
      select: { granted: true, permission: { select: { key: true } } },
    }),
  ])

  const effective = new Set(roleGrants.map((r) => r.permission.key))
  const overrideMap = new Map<string, boolean>()
  for (const o of overrides) {
    overrideMap.set(o.permission.key, o.granted)
    if (o.granted) effective.add(o.permission.key)
    else effective.delete(o.permission.key)
  }

  return NextResponse.json({
    user: target,
    permissions: [...effective].sort().map((key) => ({
      key,
      granted: true,
      source: overrideMap.has(key) ? 'override' : 'role',
    })),
  })
}
