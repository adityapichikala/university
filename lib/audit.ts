import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { prisma } from './db'
import type { AuthContext } from './rbac'

/**
 * Central audit helper — architecture doc §4.3.
 *
 * Every state-changing action should call this once. Never hand-roll an
 * AgentActionLog insert from a route handler: details drift and rows get
 * forgotten. Auditing must also never break the request that triggered it,
 * so every failure is swallowed and logged.
 *
 * Tamper-evident chain
 * ───────────────────
 * Each row carries `prevHash` (the previous head's hash) and
 * `hash = sha256(prevHash + canonical(row))`. Editing or deleting any row
 * in the middle breaks every hash after it, which `verifyAuditChain()`
 * detects. The governance banner surfaces the head of this chain.
 *
 * The chain is best-effort: if hashing fails for any reason the row is
 * still written (with null hashes) rather than losing the audit trail.
 */

/** Chain starting point — 64 hex zeros, exactly like a Bitcoin block. */
export const AUDIT_GENESIS = '0'.repeat(64)

export interface AuditEntry {
  /** Present for authenticated actions; omit for anonymous ones (e.g. failed login). */
  ctx?: AuthContext | null
  /** Logical actor/system, e.g. "admin", "auth". */
  agentName: string
  /** Verb, e.g. USER_CREATE, LOGIN_FAILURE. */
  actionType: string
  /** Model/entity touched, e.g. "User", "Permission". */
  targetEntity: string
  /** Primary key of the touched row (stored inside `details`). */
  entityId?: string | null
  /** State before the mutation. */
  before?: unknown
  /** State after the mutation. */
  after?: unknown
  /** Defaults to EXECUTED. Use REJECTED for denials, FAILED for errors. */
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED'
  /** Override the client IP (e.g. from a NextRequest). */
  ip?: string | null
  /** Override the tenant (defaults to the caller's college). */
  collegeId?: string | null
  /** Actor id when the action was performed on behalf of someone else. */
  actorId?: string | null
}

/* ── Hashing ───────────────────────────────────────────────────────────────── */

/**
 * Deterministic serialisation: object keys sorted, `undefined` dropped.
 * Without this, two logically identical rows could hash differently just
 * because Prisma returned their keys in a different order.
 */
export function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value instanceof Date) return `"${value.toISOString()}"`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

/** sha256(prevHash ‖ canonical(row)) — one link in the chain. */
export function computeAuditHash(prevHash: string, row: Record<string, unknown>): string {
  return createHash('sha256').update(prevHash + canonical(row)).digest('hex')
}

/* ── Write ─────────────────────────────────────────────────────────────────── */

export async function audit(entry: AuditEntry): Promise<void> {
  const {
    ctx,
    agentName,
    actionType,
    targetEntity,
    entityId = null,
    before = null,
    after = null,
    status = 'EXECUTED',
    ip,
    collegeId,
    actorId,
  } = entry

  try {
    let clientIp = ip ?? null
    if (clientIp === null) {
      const h = await headers()
      clientIp = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    }

    const timestamp = new Date()
    const approvedByUserId = actorId ?? ctx?.user.id ?? null
    const row = {
      agentName,
      actionType,
      targetEntity,
      status,
      approvedByUserId,
      collegeId: collegeId ?? ctx?.user.collegeId ?? null,
      details: JSON.stringify({
        entityId,
        before,
        after,
        ip: clientIp,
        at: timestamp.toISOString(),
      }),
      timestamp,
    }

    // Chain link. Wrapped separately so a hashing failure still writes the row.
    let prevHash: string | null = null
    let hash: string | null = null
    try {
      const head = await prisma.agentActionLog.findFirst({
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        select: { hash: true },
      })
      prevHash = head?.hash ?? AUDIT_GENESIS
      hash = computeAuditHash(prevHash, row)
    } catch (chainError) {
      console.error('[audit] hash chain unavailable, writing unhashed row:', chainError)
    }

    await prisma.agentActionLog.create({ data: { ...row, prevHash, hash } })
  } catch (error) {
    // Auditing must never take down the request that triggered it.
    console.error('[audit] failed to write AgentActionLog:', error)
  }
}

/* ── Read ──────────────────────────────────────────────────────────────────── */

export interface AuditHead {
  id: string
  hash: string | null
  prevHash: string | null
  timestamp: Date
  actionType: string
  targetEntity: string
  agentName: string
  actor: { id: string; name: string; regno: string } | null
  /** Total rows in the chain (for the "N entries" caption). */
  length: number
}

/** Head of the chain + actor — everything the governance banner renders. */
export async function getAuditHead(collegeId?: string | null): Promise<AuditHead | null> {
  try {
    const [head, length] = await Promise.all([
      prisma.agentActionLog.findFirst({
        where: collegeId ? { collegeId } : {},
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          hash: true,
          prevHash: true,
          timestamp: true,
          actionType: true,
          targetEntity: true,
          agentName: true,
          approvedBy: { select: { id: true, name: true, regno: true } },
        },
      }),
      prisma.agentActionLog.count({ where: collegeId ? { collegeId } : {} }),
    ])

    if (!head) return null

    return {
      id: head.id,
      hash: head.hash,
      prevHash: head.prevHash,
      timestamp: head.timestamp,
      actionType: head.actionType,
      targetEntity: head.targetEntity,
      agentName: head.agentName,
      actor: head.approvedBy,
      length,
    }
  } catch (error) {
    console.error('[audit] failed to read chain head:', error)
    return null
  }
}

export interface ChainIntegrity {
  checked: number
  /** Total rows considered (may exceed `checked` when capped). */
  total: number
  valid: boolean
  /** Id of the first row whose hash does not match, if any. */
  brokenAtId: string | null
  /** Rows written before the hash chain existed — not a failure. */
  unhashed: number
}

/**
 * Re-walk the most recent `limit` rows and re-derive every hash.
 * Any edit, deletion or re-ordering downstream of a row breaks the chain
 * and shows up here. Old pre-chain rows (hash === null) are counted but
 * not treated as tampering.
 */
export async function verifyAuditChain(limit = 250): Promise<ChainIntegrity> {
  const empty: ChainIntegrity = { checked: 0, total: 0, valid: true, brokenAtId: null, unhashed: 0 }

  try {
    const total = await prisma.agentActionLog.count()
    const rows = await prisma.agentActionLog.findMany({
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        hash: true,
        prevHash: true,
        agentName: true,
        actionType: true,
        targetEntity: true,
        status: true,
        approvedByUserId: true,
        collegeId: true,
        details: true,
        timestamp: true,
      },
    })

    let unhashed = 0
    for (const row of rows) {
      if (!row.hash) {
        unhashed += 1
        continue
      }
      const expected = computeAuditHash(row.prevHash ?? AUDIT_GENESIS, {
        agentName: row.agentName,
        actionType: row.actionType,
        targetEntity: row.targetEntity,
        status: row.status,
        approvedByUserId: row.approvedByUserId,
        collegeId: row.collegeId,
        details: row.details,
        timestamp: row.timestamp,
      })
      if (expected !== row.hash) {
        return { checked: rows.length, total, valid: false, brokenAtId: row.id, unhashed }
      }
    }

    return { checked: rows.length, total, valid: true, brokenAtId: null, unhashed }
  } catch (error) {
    console.error('[audit] chain verification failed:', error)
    return { ...empty, valid: false }
  }
}
