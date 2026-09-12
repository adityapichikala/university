import { audit } from './audit'

/**
 * Write half of crash reporting.
 *
 * Kept separate from `lib/audit-log.ts` because that module is imported by
 * client components (the audit filter bar reads `AUDIT_STATUSES`), and this one
 * pulls in `next/headers` through `lib/audit`.
 *
 * Deliberately NOT marked with `import 'server-only'`: that package is not a
 * dependency here, and the boundary holds without it — anything importing this
 * file from a client component fails the build with a `next/headers` error,
 * which is exactly the signal the marker would give.
 */

export interface CrashReport {
  /** Where the crash happened, e.g. "global-error" or "app/dashboard". */
  source: string
  message: string
  /** First frames of the stack, already trimmed by `describeError`. */
  stack?: string
  digest?: string
  /** Route or URL the user was on, when known. */
  path?: string
  /** Server-generated id, so a user quoting it can be matched to this row. */
  reference: string
}

/**
 * Write a crash to the audit trail as a FAILED AgentActionLog row.
 *
 * Uses the same hash chain as every other action, so a crash that happens
 * *because* the database is unavailable simply fails again — which is why the
 * whole thing is wrapped and never throws into the error boundary. A crashing
 * crash reporter would replace the user's error with a worse one.
 *
 * Returns whether the row was actually persisted, so the error screen can tell
 * "recorded" from "we tried".
 */
export async function recordCrash(report: CrashReport): Promise<boolean> {
  try {
    await audit({
      // No ctx: a global error boundary can fire before authentication, and a
      // crash log should not claim an actor we cannot verify. `ip: null` is
      // explicit so `audit()` skips the `headers()` call — which is also what
      // keeps this callable from a context where headers are unavailable.
      agentName: 'system',
      actionType: 'SYSTEM_CRASH',
      targetEntity: report.source,
      entityId: report.reference,
      status: 'FAILED',
      ip: null,
      collegeId: null,
      after: {
        reference: report.reference,
        message: report.message,
        digest: report.digest ?? null,
        path: report.path ?? null,
        stack: report.stack ?? null,
      },
    })
    return true
  } catch (error) {
    // Stderr is the last resort — a log aggregator still sees it even when the
    // database (and therefore the chain) is the thing that is down.
    console.error(`[crash ${report.reference}] ${report.source}: ${report.message}`, error)
    return false
  }
}
