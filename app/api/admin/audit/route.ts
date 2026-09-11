import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { authorizePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import {
  auditStatusCounts,
  auditUnhashedCount,
  listAuditActionTypes,
  listAuditActors,
  parseAuditDay,
  parseAuditDayEnd,
  queryAuditLog,
} from '@/lib/audit-log'
import { verifyAuditChain } from '@/lib/audit'

/**
 * GET /api/admin/audit — the HTTP twin of /dashboard/admin/audit.
 *
 *   ?actionType=PERMISSION_SET&status=REJECTED&q=TCH002
 *   &from=2026-09-01&to=2026-09-30&page=1&pageSize=25
 *
 * Guarded by `user.manage`. Same core as the screen, so curl and the browser
 * can never disagree about what happened.
 */

const querySchema = z.object({
  actionType: z.string().trim().min(1).optional(),
  actorId: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD')
    .optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

export async function GET(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response
  const collegeId = result.ctx.user.collegeId

  const params = Object.fromEntries(req.nextUrl.searchParams)
  const parsed = querySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid query parameters' },
      { status: 400 }
    )
  }

  const filters = {
    collegeId,
    actionType: parsed.data.actionType,
    actorId: parsed.data.actorId,
    status: parsed.data.status,
    q: parsed.data.q,
    from: parseAuditDay(parsed.data.from),
    to: parseAuditDayEnd(parsed.data.to),
  }

  const [page, counts, unhashed] = await Promise.all([
    queryAuditLog(filters, parsed.data.page ?? 1, parsed.data.pageSize ?? 25),
    auditStatusCounts(filters),
    auditUnhashedCount(filters),
  ])

  return NextResponse.json({
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    pageCount: page.pageCount,
    counts,
    unhashed,
    entries: page.rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      agentName: r.agentName,
      actionType: r.actionType,
      targetEntity: r.targetEntity,
      status: r.status,
      actor: r.actor,
      hash: r.hash,
      prevHash: r.prevHash,
      details: r.details,
    })),
  })
}

/** GET /api/admin/audit/meta — filter dropdowns + chain integrity. */
export async function OPTIONS(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response
  const collegeId = result.ctx.user.collegeId

  const [actionTypes, actors, integrity] = await Promise.all([
    listAuditActionTypes(collegeId),
    listAuditActors(collegeId),
    Promise.resolve(verifyAuditChain(500)),
  ])

  return NextResponse.json({ actionTypes, actors, integrity })
}
