'use client'

import * as React from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { cn } from '@/lib/utils'

/**
 * "Pay online" for any amount a student owes.
 *
 * The gateway is not wired up yet, and the one thing this button must not do is
 * pretend otherwise. A button that silently does nothing — or that navigates to
 * a dead checkout — is worse than no button, because the student cannot tell a
 * broken page from a payment they think they have made.
 *
 * So it opens a panel that is honest about where things stand and still useful:
 * the exact amount outstanding, what it is for, and a reference to quote when
 * paying at the counter today. When the gateway lands, `PayGateway` below is
 * the single place that changes — the trigger, the summary and the layout stay
 * put.
 *
 * Shared by the fees and library screens, which owe money for different reasons
 * but present it identically. All amounts arrive pre-formatted from the server:
 * `Intl` formatting is locale-dependent, and recomputing on the client would
 * let the panel disagree with the ledger.
 */

export interface PayableDetail {
  label: string
  value: string
  /** Renders in the danger tone — used for an overdue date. */
  danger?: boolean
}

export interface Payable {
  /** What is being paid for, e.g. "B.Tech CSE — Semester 5". */
  title: string
  /** Secondary line, e.g. the batch year or the loan period. */
  subtitle?: string
  /** Pre-formatted amount still owed; always non-zero when this renders. */
  amountDisplay: string
  /** What the student quotes at the counter. */
  reference: string
  /** Rows in the detail grid. */
  details: PayableDetail[]
  /** Changes the trigger colour and sharpens the copy. */
  overdue?: boolean
  /** Where to pay, and what happens next. */
  guidance?: string
  /** Accessible label for the trigger, when "Pay online" is too terse. */
  label?: string
}

export function PayOnlineButton({ payable }: { payable: Payable }) {
  const [open, setOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(payable.reference)
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
        aria-label={payable.label ?? `Pay ${payable.amountDisplay} online`}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-colors',
          payable.overdue
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
            <div className="min-w-0">
              <Dialog.Title className="font-heading text-base font-semibold text-foreground">
                Pay online
              </Dialog.Title>
              <p className="mt-0.5 truncate text-xs text-muted">
                {payable.title}
                {payable.subtitle ? ` · ${payable.subtitle}` : ''}
              </p>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-m-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-subtle hover:bg-background hover:text-foreground"
            >
              <span className="material-symbols-outlined text-[18px] leading-none">close</span>
            </Dialog.Close>
          </div>

          <div className="mt-5">
            <p className="text-xs text-muted">Amount due</p>
            <p className="num mt-0.5 text-2xl font-bold text-foreground">
              {payable.amountDisplay}
            </p>
          </div>

          {payable.details.length > 0 ? (
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm">
              {payable.details.map((detail) => (
                <div key={detail.label}>
                  <dt className="text-xs text-muted">{detail.label}</dt>
                  <dd
                    className={cn(
                      'num mt-0.5',
                      detail.danger ? 'font-medium text-danger' : 'text-muted'
                    )}
                  >
                    {detail.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="mt-4 rounded-xl border border-border bg-background p-3">
            <p className="text-xs font-medium text-muted">Payment reference</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="num text-sm font-semibold text-foreground">
                {payable.reference}
              </code>
              <button
                type="button"
                onClick={copyReference}
                className="rounded-lg px-2 py-1 text-[11px] text-accent transition-colors hover:bg-accent-soft"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <PayGateway payable={payable} />

          <div className="mt-5 flex justify-end">
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
function PayGateway({ payable }: { payable: Payable }) {
  return (
    <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
        <span className="material-symbols-outlined text-[16px] leading-none">schedule</span>
        Online payment is being enabled
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-warning/90">
        Card and UPI checkout is not live yet, so this button cannot take a payment
        {payable.overdue ? ' — and this amount is already overdue' : ''}. Until it is,{' '}
        {payable.guidance ??
          'pay at the office quoting the reference above, and the balance here updates the moment the receipt is posted.'}
      </p>
    </div>
  )
}
