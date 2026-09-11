/** Shared shapes passed from the server panels into the client matrices. */

export interface MatrixCell {
  /** What the user can actually do right now. */
  effective: boolean
  /** Explicit per-user override, or null when inherited from the role. */
  override: boolean | null
  inherited: boolean
}

export interface PermissionColumn {
  key: string
  label: string
  description?: string
  icon?: string
}

export interface FacultyRow {
  id: string
  name: string
  regno: string
  role: string
  email: string
  courseCount: number
}

export interface StudentRow {
  id: string
  name: string
  regno: string
  email: string
  className: string | null
}

export interface CourseRow {
  id: string
  code: string
  name: string
  teacherName: string | null
}

export interface ClassRow {
  id: string
  name: string
  semester: number
}

/** userId → permissionKey → cell */
export type AccessMatrix = Record<string, Record<string, MatrixCell>>
