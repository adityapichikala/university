/**
 * In-memory IP rate limiter for auth and public endpoints.
 * 
 * Note: Since this is in-memory, it resets on every deploy or server restart.
 * For a distributed production setup, this would be backed by Redis.
 * However, this provides sufficient protection against naive brute force
 * attacks from single IPs for this system.
 */

const hits = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(ip: string, maxPerWindow: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = hits.get(ip)

  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + windowMs })
    // Opportunistic cleanup so the map cannot grow without bound.
    if (hits.size > 1000) {
      for (const [key, value] of hits) {
        if (now > value.resetAt) hits.delete(key)
      }
    }
    return false
  }

  entry.count += 1
  return entry.count > maxPerWindow
}

/** Extracts the best guess for the client IP from the request headers. */
export function getIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp
  return 'unknown'
}
