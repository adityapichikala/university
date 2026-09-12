'use client'

import * as React from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * "Pay online" for one fee record.
 *
 * The gateway is not wired up yet, and the one thing this button must not do is
 * pretend otherwise. A button that silently does nothing — or that navigates to
 * a dead checkout — is worse than no button, because the student cannot tell a
 * broken page from a payment they think they have made.
 *
 * So it opens a panel that is honest about where things stand and still useful:
 * the exact amount outstanding, the record it belongs to, and a reference to
 * quote when paying at the counter today. When the gateway lands, `PayGateway`
 * below is the single place that changes — the trigger, the summary and the
 * layout stay put.
 *
 * Server-provided strings only: `formatCurrency` uses Intl and the server has
 * already resolved the amounts, so nothing is recomputed on the client where it
 * could disagree with the ledger.
 */

export interface PayableRecord {
  id: string
  /** e.g. "B.Tech CSE — Semester 5". */
  programName: string
  batchYear: number
  /** Pre-formatted, e.g. "₹85,000". */
  billedDisplay: string
  paidDisplay: string
  /** Pre-formatted outstanding balance; always > 0 when this renders. */
  outstandingDisplay: string
  dueDate: string
  status: string
  overdue: boolean
}

export function PayOnlineButton({ record }: { record: PayableRecord }) {
  const [open, setOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  // A stable, human-quotable reference. Derived from the record id rather than
  // invented, so it can be matched back to the row it came from.
  const reference = `FEE-${record.id.slice(-8).toUpperCase()}`

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(reference)
      setCopied(true)
      // Reset the confirmation without leaving a timer running on unmount.
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access is permission-gated and can be denied; the reference
      // is on screen and selectable, so this is a nicety, not the mechanism.
      setCopied(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-colors',
          record.overdue
            ? 'bg-danger text-white hover:bg-danger/90'
            : 'bg-accent text-white hover:bg-accent-hover'
        )}
      >
        <span className="material-symbols-outlined text-[16px] leading-none">payments</span>
        Pay online
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="animate-fade fixed inset-0 z-40 bg-primary/40" />
        <Dialog.Popup className="animate-fade fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 shadow-lift focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-heading text-base font-semibold text-foreground">
                Pay online
              </Dialog.Title>
              <p className="mt-0.5 text-xs text-muted">
                {record.programName} · {record.batchYear}
              </p>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-m-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-subtle hover:bg-background hover:text-foreground"
            >
              <span className="material-symbols-outlined text-[18px] leading-none">close</span>
            </Dialog.Close>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Outstanding</dt>
              <dd className="num mt-0.5 text-lg font-bold text-foreground">
                {record.outstandingDisplay}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Due</dt>
              <dd className={cn('num mt-0.5', record.overdue ? 'text-danger' : 'text-foreground')}>
                {record.dueDate}
                {record.overdue ? <span className="ml-1 text-xs">· overdue</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Billed</dt>
              <dd className="num mt-0.5 text-muted">{record.billedDisplay}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Already paid</dt>
              <dd className="num mt-0.5 text-muted">{record.paidDisplay}</dd>
            </div>
          </dl>

          <div className="mt-5 rounded-xl border border-border bg-background p-3">
            <p className="text-xs font-medium text-muted">Payment reference</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="num text-sm font-semibold text-foreground">{reference}</code>
              <button
                type="button"
                onClick={copyReference}
                className="rounded-lg px-2 py-1 text-[11px] text-accent transition-colors hover:bg-accent-soft"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <PayGateway record={record} />

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close className="inline-flex h-10 items-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-background">
              Close
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * The gateway itself — deliberately the only part that is not yet built.
 *
 * It states the situation plainly instead of offering a button that would do
 * nothing. Swapping this component for a real checkout is the whole migration.
 */
function PayGateway({ record }: { record: PayableRecord }) {
  return (
    <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
        <span className="material-symbols-outlined text-[16px] leading-none">schedule</span>
        Online payment is being enabled
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-warning/90">
        Card and UPI checkout is not live yet, so this button cannot take a payment
        {record.overdue ? ' — and this record is already overdue' : ''}. Until it is, pay at the
        finance office quoting the reference above, and the balance here updates the moment the
        receipt is posted.
      </p>
    </div>
  )
}
