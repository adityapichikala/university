/**
 * Error normalisation, shared by the server sink and the client boundary.
 *
 * Kept in its own module with no imports: `lib/audit-log.ts` pulls in Prisma
 * and `next/headers`, so a client component cannot use anything from there.
 * This file has to stay dependency-free for both sides to import it.
 */

const MAX_MESSAGE_CHARS = 500
const MAX_STACK_CHARS = 6000

export interface DescribedError {
  message: string
  stack?: string
  digest?: string
}

/**
 * Normalise anything throwable into a plain object.
 *
 * `Error` does not serialise through JSON — it produces `{}` — and a value
 * caught from a `throw` can be a circular object that `JSON.stringify` throws
 * on. Both cases are handled rather than left to the caller.
 */
export function describeError(error: unknown): DescribedError {
  if (error instanceof Error) {
    return {
      message: error.message.slice(0, MAX_MESSAGE_CHARS) || error.name,
      stack: error.stack?.slice(0, MAX_STACK_CHARS),
      // Next attaches a digest to server-side errors so the client can quote it.
      digest:
        typeof (error as { digest?: unknown }).digest === 'string'
          ? ((error as unknown as { digest: string }).digest)
          : undefined,
    }
  }

  if (typeof error === 'string') return { message: error.slice(0, MAX_MESSAGE_CHARS) }

  try {
    const json = JSON.stringify(error)
    return { message: (json ?? String(error)).slice(0, MAX_MESSAGE_CHARS) }
  } catch {
    return { message: 'Unknown error (unserialisable)' }
  }
}

/**
 * A short, unambiguous id a user can read off the error screen.
 *
 * Two crashes in the same second are distinguished by a 4-char base-36 suffix,
 * which is enough for the volume a single college generates — and short enough
 * to be read aloud without spelling out a UUID.
 */
export function crashReference(now: Date = new Date()): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  const suffix = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')
    .toUpperCase()
  return `${stamp}-${suffix}`
}
