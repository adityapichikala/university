import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { crashReference } from '@/lib/crash-describe'
import { recordCrash } from '@/lib/crash-record'

/**
 * POST /api/telemetry/crash — client crash sink.
 *
 * A `global-error.tsx` boundary is a *client* component: it cannot import
 * `lib/db`, so it cannot write its own audit row. It posts here instead, and
 * this route does the writing.
 *
 * Deliberately unauthenticated. The crash that matters most is the one that
 * happens before login, or because authentication itself failed — requiring a
 * session would discard exactly those reports. The endpoint is therefore
 * treated as hostile input: length-capped, rate-limited per IP, and it never
 * echoes anything back beyond a reference id.
 */

const schema = z.object({
  /** Where it happened, e.g. "global-error". Capped so it cannot be a payload. */
  source: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(6000).optional(),
  digest: z.string().max(200).optional(),
  path: z.string().max(500).optional(),
})

/** Simple fixed-window limiter. In-process, so it resets on deploy — fine for
 *  a crash sink, where the goal is noise control, not security. */
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20
const hits = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string, now: number): boolean {
  const entry = hits.get(ip)
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    // Opportunistic cleanup so the map cannot grow without bound.
    if (hits.size > 500) {
      for (const [key, value] of hits) if (now > value.resetAt) hits.delete(key)
    }
    return false
  }
  entry.count += 1
  return entry.count > MAX_PER_WINDOW
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  if (rateLimited(ip, Date.now())) {
    return NextResponse.json({ error: 'Too many reports' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    // Never 400 with details — a malformed crash report is not worth teaching
    // the caller the schema.
    return NextResponse.json({ error: 'Invalid report' }, { status: 400 })
  }

  const reference = crashReference()
  const stored = await recordCrash({
    source: parsed.data.source,
    message: parsed.data.message,
    stack: parsed.data.stack,
    digest: parsed.data.digest,
    path: parsed.data.path,
    reference,
  })

  // `stored: false` means the sink itself failed. The client shows the
  // reference either way — the user can still quote it, and the message is on
  // stderr for whoever reads the logs.
  return NextResponse.json({ reference, stored }, { status: 202 })
}

/** GET exists only so a browser visit explains itself instead of 405-ing. */
export async function GET() {
  return NextResponse.json(
    { error: 'POST a crash report here', see: 'app/global-error.tsx' },
    { status: 405 }
  )
}
