import Link from 'next/link'
import { getAuditHead, verifyAuditChain } from '@/lib/audit'
import { EmptyState } from '@/components/ui/states'
import { RefreshButton } from './refresh-button'

/**
 * Cryptographic audit banner.
 *
 * Shows the head of the SHA-256 hash chain over AgentActionLog — the row
 * that every future entry will be linked to. If anyone edits or deletes an
 * entry underneath, the chain breaks and this banner says so.
 */

function shortHash(hash: string): string {
  if (hash.length <= 28) return hash
  return `${hash.slice(0, 20)}…${hash.slice(-6)}`
}

const UTC_STAMP = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'UTC',
})

export async function AuditBannerPanel({ collegeId }: { collegeId: string | null }) {
  const [head, integrity] = await Promise.all([getAuditHead(collegeId), verifyAuditChain(250)])

  if (!head) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6 shadow-soft">
        <EmptyState
          icon="history_toggle_off"
          title="No audit entries yet"
          description="The tamper-evident chain starts with the first state-changing action — a login, a permission toggle, anything."
        />
      </section>
    )
  }

  const tampered = !integrity.valid

  return (
    <section
      aria-label="Cryptographic audit trail"
      className="relative overflow-hidden rounded-xl bg-primary p-5 shadow-card"
    >
      {/* Indigo wash — the one place a large indigo field is allowed. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent/25 blur-3xl"
      />

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined mt-0.5 rounded-xl bg-white/10 p-2.5 text-[20px] leading-none text-white">
            shield_lock
          </span>
          <div>
            <h2 className="font-heading text-sm font-semibold text-white">
              Cryptographic audit trail
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-white/60">
              SHA-256 chained ·{' '}
              <span className="num text-white/80">{head.length}</span> entries ·{' '}
              <span className="num text-white/80">{integrity.checked}</span> verified
            </p>
          </div>
        </div>

        <div className="grid flex-1 gap-4 sm:grid-cols-3 lg:max-w-2xl">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
              Last hash
            </p>
            {head.hash ? (
              <p
                className="num mt-1 truncate text-sm text-white"
                title={head.hash}
                aria-label={`Audit hash ${head.hash}`}
              >
                {shortHash(head.hash)}
              </p>
            ) : (
              <p className="num mt-1 text-sm text-warning">unhashed</p>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
              Timestamp
            </p>
            <p className="num mt-1 text-sm text-white">{UTC_STAMP.format(head.timestamp)}</p>
            <p className="text-[10px] text-white/40">UTC</p>
          </div>

          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
              Actor
            </p>
            <p className="mt-1 truncate text-sm text-white">
              {head.actor?.name ?? head.agentName}
            </p>
            <p className="num truncate text-[10px] text-white/40">
              {head.actor ? `${head.actor.regno} · ` : ''}
              {head.actionType}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={
              tampered
                ? 'inline-flex items-center gap-1.5 rounded-lg bg-danger/20 px-2.5 py-1.5 text-xs font-semibold text-red-300'
                : 'inline-flex items-center gap-1.5 rounded-lg bg-success/20 px-2.5 py-1.5 text-xs font-semibold text-emerald-300'
            }
          >
            <span className="material-symbols-outlined text-[15px] leading-none">
              {tampered ? 'gpp_maybe' : 'verified'}
            </span>
            {tampered ? 'Chain broken' : 'Chain intact'}
          </span>
          <RefreshButton />
          <Link
            href="/dashboard/admin/audit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <span className="material-symbols-outlined text-[16px] leading-none">policy</span>
            Full log
          </Link>
        </div>
      </div>

      {tampered ? (
        <p className="relative mt-4 rounded-lg bg-danger/15 px-3 py-2 text-xs text-red-200">
          Integrity check failed at entry{' '}
          <span className="num">{integrity.brokenAtId ?? '—'}</span>. An audit record was modified
          outside the application.
        </p>
      ) : null}
    </section>
  )
}
