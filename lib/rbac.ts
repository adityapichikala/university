import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from './db'
import { SESSION_COOKIE, sessionCookieOptions, verifySession, type SessionPayload } from './auth'
import { getDashboardPath, roleSlug, type Role } from './roles'

/* ============================================================================
   Tier 1 + Tier 2 + Tier 3 enforcement chain (architecture doc §5):

     1. verify JWT          → verifySession()
     2. load user           → prisma.user.findUnique()
     3. check role route    → assertRouteRole()
     4. check permission    → loadPermissions() + ctx.can()
     5. scope the query     → collegeScope() / teacherScope() / studentScope()

   Pages & Server Actions  → requireUser() / requirePermission()  (redirect)
   Route Handlers          → authorize()   / authorizePermission() (JSON 401/403)
   ========================================================================= */

export interface DbUser {
  id: string
  regno: string
  name: string
  email: string
  role: string
  collegeId: string | null
  departmentId: string | null
  /** Student's home section — scope for their roll number. */
  classId: string | null
  /** Roll number within that section. Null for staff. */
  rollNo: string | null
  status: string
}

export interface AuthContext {
  /** Decoded JWT (fast, untrusted-trustworthy: signature verified). */
  session: SessionPayload
  /** Fresh row from the DB — authoritative role/status at request time. */
  user: DbUser
  /** Effective permission keys, role grants already overridden by user grants. */
  permissions: Set<string>
  /** Tier 2 check. */
  can: (key: string) => boolean
}

export interface RequireOptions {
  /** Dashboard slug taken from the URL, e.g. "teacher" in /dashboard/teacher. */
  route?: string
  /** Explicit role allow-list (alternative to `route`). */
  roles?: Role[]
}

/* ── Step 1: verify JWT ─────────────────────────────────────────────────────── */

/** Server Components / Server Actions. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  return verifySession(store.get(SESSION_COOKIE)?.value)
}

/** Route Handlers (has a NextRequest). */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value)
}

/* ── Step 2: load user ──────────────────────────────────────────────────────── */

async function loadUser(userId: string): Promise<DbUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      regno: true,
      name: true,
      email: true,
      role: true,
      collegeId: true,
      departmentId: true,
      classId: true,
      rollNo: true,
      status: true,
    },
  })
}

/* ── Step 4: load effective permissions (user overrides role) ──────────────── */

export async function loadPermissions(role: string, userId: string): Promise<Set<string>> {
  const [roleGrants, userGrants] = await Promise.all([
    prisma.rolePermission.findMany({
      where: { role },
      select: { permission: { select: { key: true } } },
    }),
    prisma.userPermission.findMany({
      where: { userId },
      select: { granted: true, permission: { select: { key: true } } },
    }),
  ])

  const keys = new Set(roleGrants.map((r) => r.permission.key))

  // User-level entries win: true forces a grant, false revokes a role grant.
  for (const grant of userGrants) {
    if (grant.granted) keys.add(grant.permission.key)
    else keys.delete(grant.permission.key)
  }

  return keys
}

async function buildContext(session: SessionPayload): Promise<AuthContext | null> {
  const user = await loadUser(session.userId)
  if (!user || user.status !== 'ACTIVE') return null

  const permissions = await loadPermissions(user.role, user.id)

  return {
    session,
    user,
    permissions,
    can: (key: string) => permissions.has(key),
  }
}

/* ── Step 3: role ↔ route guard ─────────────────────────────────────────────── */

/**
 * A user may only browse their own dashboard namespace.
 * Returns true when the route belongs to the user's role.
 */
export function matchesRoute(user: DbUser, route?: string): boolean {
  if (!route) return true
  return roleSlug(user.role) === route
}

function matchesRoles(user: DbUser, roles?: Role[]): boolean {
  if (!roles || roles.length === 0) return true
  return roles.includes(user.role as Role)
}

/* ── Page / Server Action API ───────────────────────────────────────────────── */

/**
 * requireUser() — verify JWT → load user → check role route.
 * Redirects to /login when unauthenticated, or to the caller's own dashboard
 * when they are authenticated but standing on another role's route.
 */
export async function requireUser(options: RequireOptions = {}): Promise<AuthContext> {
  const session = await getSession()
  if (!session) redirect('/login')

  const ctx = await buildContext(session)
  // A valid JWT pointing at a user that no longer exists (or is inactive) is
  // a stale session, not "logged out" — go through the route that clears the
  // cookie, or proxy.ts will keep bouncing /login back here forever.
  if (!ctx) redirect('/api/auth/logout')

  if (!matchesRoute(ctx.user, options.route) || !matchesRoles(ctx.user, options.roles)) {
    redirect(getDashboardPath(ctx.user.role))
  }

  return ctx
}

/**
 * requirePermission(key) — requireUser() then a Tier-2 permission check.
 * Denied users land back on their own dashboard.
 */
export async function requirePermission(
  key: string,
  options: RequireOptions = {}
): Promise<AuthContext> {
  const ctx = await requireUser(options)
  if (!ctx.can(key)) redirect(getDashboardPath(ctx.user.role))
  return ctx
}

/* ── Route Handler API ──────────────────────────────────────────────────────── */

export type AuthorizedResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; response: NextResponse }

function deny(status: 401 | 403, message: string): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error: message }, { status }) }
}

/** Route-handler flavour of requireUser(). Never redirects — returns JSON. */
export async function authorize(
  req: NextRequest,
  options: RequireOptions = {}
): Promise<AuthorizedResult> {
  const session = await getSessionFromRequest(req)
  if (!session) return deny(401, 'Authentication required')

  const ctx = await buildContext(session)
  if (!ctx) {
    // Same stale-session case as requireUser(): a verifiable JWT for a user
    // that's gone from the DB. Clear it so the client doesn't keep resending
    // a dead cookie on every retry.
    const result = deny(401, 'Authentication required')
    result.response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })
    return result
  }

  if (!matchesRoute(ctx.user, options.route) || !matchesRoles(ctx.user, options.roles)) {
    return deny(403, 'Forbidden: wrong role for this route')
  }

  return { ok: true, ctx }
}

/** Route-handler flavour of requirePermission(). */
export async function authorizePermission(
  req: NextRequest,
  key: string,
  options: RequireOptions = {}
): Promise<AuthorizedResult> {
  const result = await authorize(req, options)
  if (!result.ok) return result
  if (!result.ctx.can(key)) {
    return deny(403, `Forbidden: missing permission "${key}"`)
  }
  return result
}

/* ── Step 5: Tier-3 query scopes ────────────────────────────────────────────── */

/**
 * Always spread one of these into your `where` clause — never run an
 * unscoped findMany/update on a tenant-owned model.
 */
export const scopes = {
  /** Multi-tenant isolation. Empty object for college-less users (e.g. PARENT). */
  college(ctx: AuthContext): { collegeId: string } | Record<string, never> {
    return ctx.user.collegeId ? { collegeId: ctx.user.collegeId } : {}
  },

  /** HOD sees only their department. */
  department(ctx: AuthContext): { departmentId: string } | Record<string, never> {
    return ctx.user.departmentId ? { departmentId: ctx.user.departmentId } : {}
  },

  /**
   * A teacher touches only the courses they teach.
   * Use on the **Course** model itself — the FK lives directly on the row.
   */
  taughtCourses(ctx: AuthContext) {
    return { teacherId: ctx.user.id }
  },

  /**
   * Models that *link* to a course (enrollments, attendance, exams…):
   * filter through the relation instead of a direct column.
   */
  teacherCourses(ctx: AuthContext) {
    return { course: { teacherId: ctx.user.id } }
  },

  /** A student touches only their own rows. */
  own(ctx: AuthContext) {
    return { studentId: ctx.user.id }
  },

  /** Teacher-scoped assignment: their course AND their college. */
  teacherAssignments(ctx: AuthContext) {
    return { ...scopes.college(ctx), course: { teacherId: ctx.user.id } }
  },
}
