import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE = 'session'

/** 7-day TTL, in seconds. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7

export interface SessionPayload {
  userId: string
  regno: string
  role: string
  collegeId: string | null
  departmentId: string | null
  name: string
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Add it to .env')
  }
  return new TextEncoder().encode(secret)
}

/**
 * Sign a 7-day session token.
 *
 * `jose` (not `jsonwebtoken`) on purpose: the route guard runs in the Edge
 * runtime where `node:crypto` is unavailable. Web Crypto only, works
 * everywhere — middleware, route handlers and server components.
 */
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret())
}

/** Verify a token. Returns null when missing, malformed or expired. */
export async function verifySession(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret())
    const p = payload as Partial<SessionPayload>
    if (!p.userId || !p.role) return null
    return {
      userId: p.userId,
      regno: p.regno ?? '',
      role: p.role,
      collegeId: p.collegeId ?? null,
      departmentId: p.departmentId ?? null,
      name: p.name ?? '',
    }
  } catch {
    return null
  }
}

/** Cookie attributes. httpOnly + SameSite=Lax (CSRF-safe, architecture doc §9). */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  }
}
