'use client'

import * as React from 'react'
import { describeError } from '@/lib/crash-describe'
import { reportCrash } from '@/lib/crash-report'
import { Button } from '@/components/ui/button'

/**
 * Root error boundary (App Router §error-handling).
 *
 * `global-error.tsx` replaces the root layout when rendering the layout itself
 * fails, which is why it ships its own `<html>`/`<body>` and cannot use the
 * app's providers — no ToastProvider, no font variables, no theme context. It
 * therefore carries its own inline styling rather than importing the design
 * system's tokens, which may not have loaded.
 *
 * Two things this screen must do, in order:
 *   1. Tell the user what to do next (go back, or retry).
 *   2. Give them a reference id so the report can be found in the audit trail.
 */

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

type Status = 'reporting' | 'reported' | 'unreported'

export default function GlobalError({ error, reset }: Props) {
  const [status, setStatus] = React.useState<Status>('reporting')
  const [reference, setReference] = React.useState<string | null>(null)
  const [showDetail, setShowDetail] = React.useState(false)

  // Report once per error. `error` is a new object on every render that the
  // boundary re-renders for, so a naive dependency would spam the sink.
  const reported = React.useRef<unknown>(null)

  React.useEffect(() => {
    if (reported.current === error) return
    reported.current = error

    let cancelled = false
    // The effect body cannot be async; the promise is fire-and-forget with a
    // guard so a late resolution cannot setState after unmount.
    reportCrash(error, 'global-error').then((result) => {
      if (cancelled) return
      setReference(result.reference)
      setStatus(result.stored ? 'reported' : 'unreported')
    })

    return () => {
      cancelled = true
    }
  }, [error])

  const described = React.useMemo(() => describeError(error), [error])

  // An auth-adjacent crash is the most likely reason someone is looking at this
  // screen; sending them to a page that may also be broken is worse than
  // sending them somewhere that will work.
  const dashboardHref = '/dashboard'

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#f6f7f9',
          color: '#0f172a',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <main
          style={{
            width: '100%',
            maxWidth: '560px',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            padding: '32px',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
          }}
        >
          <div
            aria-hidden
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: '#fee2e2',
              color: '#b91c1c',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '22px',
            }}
          >
            !
          </div>

          <h1
            style={{
              margin: '16px 0 0',
              fontSize: '20px',
              fontWeight: 700,
              letterSpacing: '-0.01em',
            }}
          >
            Something went wrong
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: '14px', lineHeight: 1.6, color: '#475569' }}>
            The page could not be rendered. Nothing you had saved was lost — but anything
            mid-flight was not submitted. Try again, or head back to your dashboard.
          </p>

          <div
            style={{
              marginTop: '20px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            {/* `reset()` re-renders the failed segment without a full reload,
                which succeeds whenever the crash was transient. */}
            <Button variant="accent" onClick={() => reset()}>
              <span className="material-symbols-outlined text-[18px] leading-none">refresh</span>
              Try again
            </Button>

            {/* A hard navigation, not next/link: this boundary replaces the
                root layout, and client-side routing is exactly what is broken. */}
            <a
              href={dashboardHref}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                height: '40px',
                padding: '0 16px',
                borderRadius: '12px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#0f172a',
                fontSize: '14px',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Return to Dashboard
            </a>
          </div>

          <div
            style={{
              marginTop: '24px',
              borderTop: '1px solid #e2e8f0',
              paddingTop: '16px',
              fontSize: '12px',
              color: '#64748b',
            }}
          >
            {status === 'reporting' ? (
              <p style={{ margin: 0 }}>Recording this error…</p>
            ) : status === 'reported' ? (
              <p style={{ margin: 0 }}>
                Reference{' '}
                <code
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    background: '#f1f5f9',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    color: '#0f172a',
                  }}
                >
                  {reference}
                </code>{' '}
                — quote this to your administrator.
              </p>
            ) : (
              <p style={{ margin: 0 }}>
                Could not record this automatically. Reference{' '}
                <code
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    background: '#f1f5f9',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    color: '#0f172a',
                  }}
                >
                  {reference ?? 'unavailable'}
                </code>{' '}
                — quote this to your administrator.
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              style={{
                marginTop: '10px',
                background: 'none',
                border: 'none',
                padding: 0,
                color: '#475569',
                fontSize: '12px',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              {showDetail ? 'Hide technical details' : 'Show technical details'}
            </button>

            {showDetail ? (
              <pre
                style={{
                  marginTop: '10px',
                  maxHeight: '180px',
                  overflow: 'auto',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  borderRadius: '10px',
                  padding: '12px',
                  fontSize: '11px',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {described.message}
                {described.digest ? `\n\ndigest: ${described.digest}` : ''}
                {described.stack ? `\n\n${described.stack}` : ''}
              </pre>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  )
}
