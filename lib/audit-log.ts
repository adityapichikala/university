import { prisma } from './db'

/**
 * Read side of the audit trail (architecture doc §4.3).
 *
 * Shared by the admin screen (`/dashboard/admin/audit`) and
 * `GET /api/admin/audit`, so the UI and curl see exactly the same rows.
 *
 * NOTE: the hash chain is GLOBAL, not per college — `prevHash` points at the
 * previous row written by anyone. That is what makes it tamper-evident across
 * tenants. College filtering only narrows what you *see*, never the chain.
 */

export const AUDIT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED'] as const
export type AuditStatus = (typeof AUDIT_STATUSES)[number]

export interface AuditLogFilters {
  collegeId?: string | null
  /** Exact match, e.g. PERMISSION_SET. */
  actionType?: string
  /** User id of `approvedBy`. */
  actorId?: string
  status?: string
  /** Free text over targetEntity and the serialised `details`. */
  q?: string
  from?: Date | null
  to?: Date | null
}

export interface AuditLogRow {
  id: string
  timestamp: Date
  agentName: string
  actionType: string
  targetEntity: string
  status: string
  collegeId: string | null
  actor: { id: string; name: string; regno: string } | null
  hash: string | null
  prevHash: string | null
  /** Parsed `details`, or null when it is not valid JSON. */
  details: {
    entityId?: string | null
    before?: unknown
    after?: unknown
    ip?: string | null
    at?: string | null
  } | null
}

export interface AuditLogPage {
  rows: AuditLogRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const PAGE_SIZE = 25

function buildWhere(filters: AuditLogFilters) {
  const where: Record<string, unknown> = {}

  if (filters.collegeId) where.collegeId = filters.collegeId
  if (filters.actionType) where.actionType = filters.actionType
  if (filters.status) where.status = filters.status
  if (filters.actorId) where.approvedByUserId = filters.actorId

  if (filters.from || filters.to) {
    const timestamp: Record<string, Date> = {}
    if (filters.from) timestamp.gte = filters.from
    if (filters.to) timestamp.lte = filters.to
    where.timestamp = timestamp
  }

  if (filters.q?.trim()) {
    const q = filters.q.trim()
    where.OR = [{ targetEntity: { contains: q } }, { details: { contains: q } }]
  }

  return where
}

function parseDetails(raw: string | null): AuditLogRow['details'] {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export async function queryAuditLog(
  filters: AuditLogFilters,
  page = 1,
  pageSize = PAGE_SIZE
): Promise<AuditLogPage> {
  const where = buildWhere(filters)
  const safePage = Math.max(1, Math.trunc(page) || 1)
  const size = Math.min(100, Math.max(1, Math.trunc(pageSize) || PAGE_SIZE))

  const [total, rows] = await Promise.all([
    prisma.agentActionLog.count({ where }),
    prisma.agentActionLog.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      skip: (safePage - 1) * size,
      take: size,
      select: {
        id: true,
        timestamp: true,
        agentName: true,
        actionType: true,
        targetEntity: true,
        status: true,
        collegeId: true,
        details: true,
        hash: true,
        prevHash: true,
        approvedBy: { select: { id: true, name: true, regno: true } },
      },
    }),
  ])

  return {
    rows: rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      agentName: r.agentName,
      actionType: r.actionType,
      targetEntity: r.targetEntity,
      status: r.status,
      collegeId: r.collegeId,
      actor: r.approvedBy,
      hash: r.hash,
      prevHash: r.prevHash,
      details: parseDetails(r.details),
    })),
    total,
    page: safePage,
    pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
  }
}

/** Distinct action types present in the log — powers the filter dropdown. */
export async function listAuditActionTypes(collegeId?: string | null): Promise<string[]> {
  const rows = await prisma.agentActionLog.findMany({
    where: collegeId ? { collegeId } : {},
    distinct: ['actionType'],
    select: { actionType: true },
    orderBy: { actionType: 'asc' },
  })
  return rows.map((r) => r.actionType)
}

/** Everyone who has ever been recorded as an actor. */
export async function listAuditActors(
  collegeId?: string | null
): Promise<Array<{ id: string; name: string; regno: string }>> {
  const rows = await prisma.agentActionLog.findMany({
    where: {
      ...(collegeId ? { collegeId } : {}),
      approvedByUserId: { not: null },
    },
    distinct: ['approvedByUserId'],
    select: { approvedBy: { select: { id: true, name: true, regno: true } } },
  })
  return rows
    .map((r) => r.approvedBy)
    .filter((a): a is { id: string; name: string; regno: string } => Boolean(a))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Status tallies for the current filter — the little chip row above the table. */
export async function auditStatusCounts(
  filters: AuditLogFilters
): Promise<Record<string, number>> {
  const base = buildWhere(filters)
  delete base.status

  const rows = await prisma.agentActionLog.groupBy({
    by: ['status'],
    where: base,
    _count: { _all: true },
  })

  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.status] = row._count._all
  return counts
}

/** How many rows in this filter predate the hash chain (informational). */
export async function auditUnhashedCount(filters: AuditLogFilters): Promise<number> {
  return prisma.agentActionLog.count({ where: { ...buildWhere(filters), hash: null } })
}

/** `YYYY-MM-DD` → UTC-midnight Date. Mirrors lib/academics.parseDay(). */
export function parseAuditDay(value?: string | null): Date | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Inclusive end of a day filter: `to` becomes 23:59:59.999 UTC. */
export function parseAuditDayEnd(value?: string | null): Date | null {
  const start = parseAuditDay(value)
  if (!start) return null
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)
}

// ── Crash reporting ─────────────────────────────────────────────────────────

/**
 * The read half of crash reporting only.
 *
 * `recordCrash()` writes an AgentActionLog, which means importing `lib/audit`
 * and `next/headers` — neither of which may reach a client bundle. Since this
 * module *is* imported by client components (the audit filter bar reads
 * `AUDIT_STATUSES`), the write path lives in `lib/crash-record.ts`, which is
 * server-only by construction.
 *
 * `describeError` / `crashReference` are pure and stay client-safe here.
 */
export { describeError, crashReference } from './crash-describe'
export type { DescribedError } from './crash-describe'
