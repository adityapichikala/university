import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/states'
import { verifyAuditChain } from '@/lib/audit'
import {
  auditStatusCounts,
  auditUnhashedCount,
  parseAuditDay,
  parseAuditDayEnd,
  queryAuditLog,
} from '@/lib/audit-log'
import { cn } from '@/lib/utils'
import { AuditTable, type AuditEntryView } from './audit-table'

/**
 * Results panel: integrity strip → status chips → table → pagination.
 * Lives in its own async component so the filter bar above it never blocks
 * and re-filtering shows the skeleton instead of a frozen page.
 */

const UTC_STAMP = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'UTC',
})

function pretty(value: unknown): string | null {
  if (value === null || value === undefined) return null
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export type RawParams = Record<string, string | string[] | undefined>

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export async function AuditResults({
  collegeId,
  params,
}: {
  collegeId: string | null
  params: RawParams
}) {
  const actionType = firstParam(params.actionType)
  const actorId = firstParam(params.actorId)
  const status = firstParam(params.status)
  const q = firstParam(params.q)
  const from = firstParam(params.from)
  const to = firstParam(params.to)
  const page = Number(firstParam(params.page) ?? '1')

  const filters = {
    collegeId,
    actionType,
    actorId,
    status,
    q,
    from: parseAuditDay(from),
    to: parseAuditDayEnd(to),
  }

  const [result, counts, unhashed, integrity] = await Promise.all([
    queryAuditLog(filters, page),
    auditStatusCounts(filters),
    auditUnhashedCount(filters),
    Promise.resolve(verifyAuditChain(500)),
  ])

  const rows: AuditEntryView[] = result.rows.map((r) => ({
    id: r.id,
    time: UTC_STAMP.format(r.timestamp),
    actionType: r.actionType,
    targetEntity: r.targetEntity,
    status: r.status,
    agentName: r.agentName,
    actorName: r.actor?.name ?? null,
    actorRegno: r.actor?.regno ?? null,
    hash: r.hash,
    prevHash: r.prevHash,
    entityId: r.details?.entityId ?? null,
    ip: r.details?.ip ?? null,
    before: pretty(r.details?.before),
    after: pretty(r.details?.after),
  }))

  return (
    <div className="space-y-4">
      {/* Integrity strip — the whole point of the chain. */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3',
          integrity.valid
            ? 'border-success/30 bg-success-soft/50'
            : 'border-danger/30 bg-danger-soft/50'
        )}
      >
        <span
          className={cn(
            'material-symbols-outlined text-[18px] leading-none',
            integrity.valid ? 'text-success' : 'text-danger'
          )}
        >
          {integrity.valid ? 'verified' : 'gpp_maybe'}
        </span>
        <p className="text-xs text-foreground">
          {integrity.valid ? (
            <>
              Chain verified — <span className="num">{integrity.checked}</span> of{' '}
              <span className="num">{integrity.total}</span> entries re-hashed,{' '}
              <span className="num">{integrity.unhashed}</span> predate the chain.
            </>
          ) : (
            <>
              Chain broken at <span className="num">{integrity.brokenAtId ?? '—'}</span> — an entry
              was modified outside the application.
            </>
          )}
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
          <span className="num text-xs text-subtle">
            {result.total.toLocaleString('en-US')} entries
          </span>
          <span className="h-3 w-px bg-border" />
          {Object.entries(counts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => (
              <span
                key={key}
                className="num rounded-md bg-background px-2 py-0.5 text-[10px] font-medium text-muted"
              >
                {key} {value}
              </span>
            ))}
          {unhashed > 0 ? (
            <span className="num rounded-md bg-warning-soft px-2 py-0.5 text-[10px] font-medium text-warning">
              unhashed {unhashed}
            </span>
          ) : null}
        </div>

        <AuditTable rows={rows} />

        {result.pageCount > 1 ? (
          <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3">
            <p className="num text-xs text-subtle">
              page {result.page} / {result.pageCount}
            </p>
            <div className="flex items-center gap-2">
              <PageLink params={params} page={result.page - 1} disabled={result.page <= 1}>
                Previous
              </PageLink>
              <PageLink
                params={params}
                page={result.page + 1}
                disabled={result.page >= result.pageCount}
              >
                Next
              </PageLink>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  )
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: RawParams
  page: number
  disabled?: boolean
  children: React.ReactNode
}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    const single = firstParam(value)
    if (single && key !== 'page') search.set(key, single)
  }
  search.set('page', String(page))

  if (disabled) {
    return (
      <span className="inline-flex h-8 cursor-not-allowed items-center rounded-lg border border-border bg-background px-3 text-xs text-subtle">
        {children}
      </span>
    )
  }

  return (
    <Link
      href={`/dashboard/admin/audit?${search.toString()}`}
      className="inline-flex h-8 items-center rounded-lg border border-border-strong bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-background"
    >
      {children}
    </Link>
  )
}

export function AuditResultsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 rounded-xl" />
      <Card>
        <div className="border-b border-border px-6 py-3">
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="space-y-3 p-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
