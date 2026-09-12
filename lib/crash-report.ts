'use client'

import { crashReference, describeError } from './crash-describe'

/**
 * Browser-side crash reporting.
 *
 * A `global-error.tsx` boundary is a client component and cannot touch the
 * database, so it POSTs the report and gets a reference id back. The id is the
 * whole point: the user reads it off the screen and an operator greps the
 * audit trail for it, which turns "it broke" into a specific row with a stack.
 *
 * Reporting must never make a bad situation worse, so every failure path here
 * resolves rather than rejects. The boundary has already replaced the app with
 * an error screen; a second throw would replace that screen with a blank page.
 */

export interface CrashReport {
  source: string
  message: string
  stack?: string
  digest?: string
  path?: string
}

export interface CrashResult {
  /** Shown to the user; they can quote it when reporting the problem. */
  reference: string
  /** False when even the sink could not record it. */
  stored: boolean
}

/**
 * Report a crash and always resolve with something to display.
 *
 * `keepalive` matters: the boundary may be mounted on a page the user is about
 * to navigate away from, and a normal fetch is cancelled on unload — losing
 * exactly the report that prompted them to leave.
 */
export async function reportCrash(error: unknown, source = 'global-error'): Promise<CrashResult> {
  const described = describeError(error)
  const path = typeof window === 'undefined' ? undefined : window.location.pathname

  const payload = {
    source,
    message: described.message,
    stack: described.stack,
    digest: described.digest,
    path,
  }

  try {
    const res = await fetch('/api/telemetry/crash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    })

    if (!res.ok) {
      console.error('[crash] sink rejected the report', res.status, described.message)
      return { reference: crashReference(), stored: false }
    }

    const body = (await res.json().catch(() => ({}))) as {
      reference?: string
      stored?: boolean
    }
    return {
      reference: body.reference ?? crashReference(),
      // A sink that answered but could not persist is a different failure from
      // an unreachable sink, and the screen says so.
      stored: body.stored ?? true,
    }
  } catch (sendError) {
    console.error('[crash] could not reach the sink', sendError, described.message)
    return { reference: crashReference(), stored: false }
  }
}
