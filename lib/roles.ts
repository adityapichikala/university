/**
 * Tier 1 RBAC — the 11 roles.
 *
 * Prisma enums are not supported on SQLite, so `User.role` is a String.
 * This file is the single source of truth for the allowed values and the
 * role → dashboard-route mapping used by the guard and the login redirect.
 */

export const ROLES = [
  'STUDENT',
  'TEACHER',
  'HOD',
  'ADMIN',
  'REGISTRAR',
  'FINANCE',
  'LIBRARIAN',
  'WARDEN',
  'HR',
  'PLACEMENT',
  'PARENT',
] as const

export type Role = (typeof ROLES)[number]

/** Role → dashboard slug. `/dashboard/<slug>` */
export const ROLE_SLUG: Record<Role, string> = {
  STUDENT: 'student',
  TEACHER: 'teacher',
  HOD: 'hod',
  ADMIN: 'admin',
  REGISTRAR: 'registrar',
  FINANCE: 'finance',
  LIBRARIAN: 'librarian',
  WARDEN: 'warden',
  HR: 'hr',
  PLACEMENT: 'placement',
  PARENT: 'parent',
}

export const ROLE_LABEL: Record<Role, string> = {
  STUDENT: 'Student',
  TEACHER: 'Teacher',
  HOD: 'Head of Department',
  ADMIN: 'Administrator',
  REGISTRAR: 'Registrar',
  FINANCE: 'Finance Officer',
  LIBRARIAN: 'Librarian',
  WARDEN: 'Hostel Warden',
  HR: 'HR Manager',
  PLACEMENT: 'Placement Officer',
  PARENT: 'Parent',
}

/** Reverse map: dashboard slug → Role. Used by the route guard. */
export const SLUG_ROLE: Record<string, Role> = Object.entries(ROLE_SLUG).reduce(
  (acc, [role, slug]) => {
    acc[slug] = role as Role
    return acc
  },
  {} as Record<string, Role>
)

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

export function roleSlug(role: string): string {
  return isRole(role) ? ROLE_SLUG[role] : 'student'
}

export function getDashboardPath(role: string): string {
  return `/dashboard/${roleSlug(role)}`
}

/**
 * Tier 2 — permission keys.
 * Seeded into the `Permission` table; granted to roles via `RolePermission`
 * and overridden per user via `UserPermission`.
 */
export const PERMISSIONS = {
  GRADE_ENTRY: 'grade.entry',
  ATTENDANCE_MARK: 'attendance.mark',
  EXAM_CREATE: 'exam.create',
  LMS_ACCESS: 'lms.access',
  EXAM_ENGINE_ACCESS: 'exam_engine.access',
  VIRTUAL_LAB_ACCESS: 'virtual_lab.access',
  USER_MANAGE: 'user.manage',
  COURSE_MANAGE: 'course.manage',
  CLASS_MANAGE: 'class.manage',
  ENROLLMENT_MANAGE: 'enrollment.manage',
  ASSIGNMENT_MANAGE: 'assignment.manage',
  SUBMISSION_SUBMIT: 'submission.submit',
  TIMETABLE_MANAGE: 'timetable.manage',

  // ── Phase 3 — Services (doc §7 Phase 3) ───────────────────────────────────
  /** Finance officer: create fee structures, assign + collect fees. */
  FEE_MANAGE: 'fee.manage',
  /** Student: see their own fee records. */
  FEE_VIEW_OWN: 'fee.view_own',
  /** Librarian: manage the catalog and issue/return books. */
  LIBRARY_MANAGE: 'library.manage',
  /** Any college member: borrow books. */
  LIBRARY_BORROW: 'library.borrow',
  /** Warden: manage rooms and allocations. */
  HOSTEL_MANAGE: 'hostel.manage',
  /** Student: see their own room allocation. */
  HOSTEL_VIEW_OWN: 'hostel.view_own',
} as const

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/** Default role → permission grants (written by the seed). */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, string[]> = {
  STUDENT: [
    PERMISSIONS.LMS_ACCESS,
    PERMISSIONS.EXAM_ENGINE_ACCESS,
    PERMISSIONS.VIRTUAL_LAB_ACCESS,
    PERMISSIONS.SUBMISSION_SUBMIT,
    PERMISSIONS.FEE_VIEW_OWN,
    PERMISSIONS.LIBRARY_BORROW,
    PERMISSIONS.HOSTEL_VIEW_OWN,
  ],
  TEACHER: [
    PERMISSIONS.GRADE_ENTRY,
    PERMISSIONS.ATTENDANCE_MARK,
    PERMISSIONS.EXAM_CREATE,
    PERMISSIONS.ASSIGNMENT_MANAGE,
    PERMISSIONS.TIMETABLE_MANAGE,
  ],
  HOD: [
    PERMISSIONS.GRADE_ENTRY,
    PERMISSIONS.ATTENDANCE_MARK,
    PERMISSIONS.EXAM_CREATE,
    PERMISSIONS.COURSE_MANAGE,
    PERMISSIONS.ASSIGNMENT_MANAGE,
    PERMISSIONS.TIMETABLE_MANAGE,
  ],
  ADMIN: Object.values(PERMISSIONS),
  REGISTRAR: [
    PERMISSIONS.EXAM_CREATE,
    PERMISSIONS.COURSE_MANAGE,
    PERMISSIONS.CLASS_MANAGE,
    PERMISSIONS.ENROLLMENT_MANAGE,
    PERMISSIONS.ASSIGNMENT_MANAGE,
    PERMISSIONS.TIMETABLE_MANAGE,
  ],
  FINANCE: [PERMISSIONS.FEE_MANAGE],
  LIBRARIAN: [PERMISSIONS.LIBRARY_MANAGE, PERMISSIONS.LIBRARY_BORROW],
  WARDEN: [PERMISSIONS.HOSTEL_MANAGE],
  HR: [],
  PLACEMENT: [],
  PARENT: [],
}
