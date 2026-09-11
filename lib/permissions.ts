import { prisma } from './db'
import { audit } from './audit'
import { scopes, type AuthContext } from './rbac'

/**
 * Governance core (architecture doc §3 Tier 2 + §4.3).
 *
 * One implementation, two front doors:
 *   • Server Actions  → app/dashboard/admin/actions.ts   (the UI)
 *   • Route Handler   → /api/admin/users/[id]/permissions (integrations)
 *
 * Both paths call these functions so a permission change behaves identically
 * whether it came from a toggle in the browser or from curl.
 *
 * Inheritance model
 * ─────────────────
 *   effective = user override  ??  role grant  ??  false
 *
 * Setting a toggle to the value the role already grants DELETES the override
 * row instead of writing a redundant one — so the matrix shows
 * "inherited" vs "override" honestly, and revoking a role grant later
 * doesn't leave stale rows behind.
 */

export type MutationResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function fail(error: string): MutationResult<never> {
  return { ok: false, error }
}

/* ── Read: build the matrix ─────────────────────────────────────────────────── */

export interface AccessCell {
  key: string
  /** What the user can actually do right now. */
  effective: boolean
  /** Explicit per-user override, or null when inherited from the role. */
  override: boolean | null
  inherited: boolean
}

export interface MatrixUser {
  id: string
  role: string
}

/**
 * Collapse role grants + user overrides into one cell per (user, permission).
 * `roleGrants` and `userOverrides` are plain arrays so the caller can fetch
 * everything in three queries regardless of how many users are on screen.
 */
export function buildAccessMatrix(
  users: MatrixUser[],
  keys: string[],
  roleGrants: Array<{ role: string; key: string }>,
  userOverrides: Array<{ userId: string; key: string; granted: boolean }>
): Record<string, Record<string, AccessCell>> {
  const byRole = new Map<string, Set<string>>()
  for (const grant of roleGrants) {
    const set = byRole.get(grant.role) ?? new Set<string>()
    set.add(grant.key)
    byRole.set(grant.role, set)
  }

  const overrides = new Map<string, boolean>()
  for (const o of userOverrides) overrides.set(`${o.userId}:${o.key}`, o.granted)

  const matrix: Record<string, Record<string, AccessCell>> = {}

  for (const user of users) {
    const row: Record<string, AccessCell> = {}
    const roleSet = byRole.get(user.role) ?? new Set<string>()

    for (const key of keys) {
      const override = overrides.get(`${user.id}:${key}`) ?? null
      const roleGrant = roleSet.has(key)
      row[key] = {
        key,
        effective: override ?? roleGrant,
        override,
        inherited: override === null,
      }
    }
    matrix[user.id] = row
  }

  return matrix
}

/* ── Write: per-user permission ─────────────────────────────────────────────── */

export interface SetPermissionInput {
  userId: string
  permissionKey: string
  granted: boolean
}

export interface SetPermissionResult {
  userId: string
  permissionKey: string
  granted: boolean
  /** How the value is now derived. */
  source: 'role' | 'override'
  roleDefault: boolean
}

export async function setUserPermission(
  ctx: AuthContext,
  input: SetPermissionInput
): Promise<MutationResult<SetPermissionResult>> {
  const { userId, permissionKey, granted } = input
  if (!userId?.trim()) return fail('Missing user id')
  if (!permissionKey?.trim()) return fail('Missing permission key')

  try {
    // Tier 3: the target user must live in the caller's college.
    const [target, permission] = await Promise.all([
      prisma.user.findFirst({
        where: { id: userId, ...scopes.college(ctx) },
        select: { id: true, regno: true, name: true, role: true },
      }),
      prisma.permission.findUnique({ where: { key: permissionKey }, select: { id: true } }),
    ])

    if (!target) return fail('User not found in your college')
    if (!permission) return fail(`Unknown permission "${permissionKey}"`)

    const roleGrants = await prisma.rolePermission.findFirst({
      where: { role: target.role, permissionId: permission.id },
      select: { role: true },
    })
    const roleDefault = Boolean(roleGrants)

    const before = { granted: roleDefault, source: 'role' as const }

    if (granted === roleDefault) {
      // Collapse back to inheritance — no override row needed.
      await prisma.userPermission.deleteMany({
        where: { userId, permissionId: permission.id },
      })
    } else {
      await prisma.userPermission.upsert({
        where: { userId_permissionId: { userId, permissionId: permission.id } },
        update: { granted },
        create: { userId, permissionId: permission.id, granted },
      })
    }

    const source: SetPermissionResult['source'] = granted === roleDefault ? 'role' : 'override'

    await audit({
      ctx,
      agentName: 'admin',
      actionType: 'PERMISSION_SET',
      targetEntity: 'UserPermission',
      entityId: `${target.regno}:${permissionKey}`,
      before,
      after: { granted, source, user: target.regno, permission: permissionKey },
    })

    return {
      ok: true,
      data: { userId, permissionKey, granted, source, roleDefault },
    }
  } catch (error) {
    console.error('[permissions] setUserPermission failed:', error)
    return fail('Could not save the permission change')
  }
}

/* ── Read: enforce section locks ────────────────────────────────────────────── */

/**
 * Prisma fragment that hides courses locked for a given class section.
 * Spread it into any `course` relation filter:
 *
 *   prisma.attendance.findMany({ where: { course: { ...sectionUnlocked(classId) } } })
 *
 * Tier 3 at resource level — the governance dashboard's section switches
 * become real the moment this appears in a query.
 */
export function sectionUnlocked(classId: string | null | undefined) {
  if (!classId) return {}
  return { NOT: { sectionAccess: { some: { classId, enabled: false } } } }
}

/**
 * Of `studentIds`, which ones belong to a class section that has been locked
 * out of `courseId`? Used by write paths (marking attendance) where a silent
 * filter would hide a real error from the teacher.
 */
export async function lockedStudentIds(
  courseId: string,
  studentIds: string[]
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set()

  const enrollments = await prisma.courseEnrollment.findMany({
    where: { courseId, studentId: { in: studentIds } },
    select: { studentId: true, classId: true },
  })
  const classIds = [...new Set(enrollments.map((e) => e.classId))]
  if (classIds.length === 0) return new Set()

  const locked = await prisma.courseSectionAccess.findMany({
    where: { courseId, classId: { in: classIds }, enabled: false },
    select: { classId: true },
  })
  if (locked.length === 0) return new Set()

  const lockedClasses = new Set(locked.map((l) => l.classId))
  return new Set(
    enrollments.filter((e) => lockedClasses.has(e.classId)).map((e) => e.studentId)
  )
}

/* ── Write: section-level course access ─────────────────────────────────────── */

export interface SetSectionAccessInput {
  courseId: string
  classId: string
  enabled: boolean
}

export interface SetSectionAccessResult {
  courseId: string
  classId: string
  enabled: boolean
}

/**
 * Tier 3 at resource level: lock a section out of a course.
 * Locked students stop seeing the course and cannot be marked for it.
 */
export async function setSectionAccess(
  ctx: AuthContext,
  input: SetSectionAccessInput
): Promise<MutationResult<SetSectionAccessResult>> {
  const { courseId, classId, enabled } = input
  if (!courseId?.trim()) return fail('Missing course id')
  if (!classId?.trim()) return fail('Missing class id')

  try {
    const [course, klass, existing] = await Promise.all([
      prisma.course.findFirst({
        where: { id: courseId, ...scopes.college(ctx) },
        select: { id: true, code: true, name: true },
      }),
      prisma.class.findFirst({
        where: { id: classId, ...scopes.college(ctx) },
        select: { id: true, name: true },
      }),
      prisma.courseSectionAccess.findUnique({
        where: { courseId_classId: { courseId, classId } },
        select: { id: true, enabled: true },
      }),
    ])

    if (!course) return fail('Course not found in your college')
    if (!klass) return fail('Class not found in your college')

    await prisma.courseSectionAccess.upsert({
      where: { courseId_classId: { courseId, classId } },
      update: { enabled },
      create: { collegeId: ctx.user.collegeId ?? '', courseId, classId, enabled },
    })

    await audit({
      ctx,
      agentName: 'admin',
      actionType: enabled ? 'SECTION_ACCESS_GRANT' : 'SECTION_ACCESS_REVOKE',
      targetEntity: 'CourseSectionAccess',
      entityId: `${course.code}:${klass.name}`,
      before: { enabled: existing?.enabled ?? true },
      after: { enabled, course: course.code, class: klass.name },
    })

    return { ok: true, data: { courseId, classId, enabled } }
  } catch (error) {
    console.error('[permissions] setSectionAccess failed:', error)
    return fail('Could not save the section access change')
  }
}
