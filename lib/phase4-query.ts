import type { PrismaClient } from '@prisma/client'

/**
 * Shared Prisma selects for the Phase 4 staff portals (HOD, HR, Placement,
 * Registrar, Parent).
 *
 * Lives outside the route files because a Next route module may only export
 * HTTP verbs — and because all five portals need the same shapes.
 */

export const EMPLOYEE_SELECT = {
  id: true,
  designation: true,
  salaryBand: true,
  joinedAt: true,
  departmentId: true,
  user: { select: { id: true, name: true, regno: true, email: true, role: true } },
  department: { select: { id: true, name: true } },
  _count: { select: { leaveRequests: true } },
} as const

export const LEAVE_REQUEST_SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  reason: true,
  status: true,
  reviewedAt: true,
  createdAt: true,
  employee: {
    select: {
      id: true,
      designation: true,
      departmentId: true,
      user: { select: { id: true, name: true, regno: true } },
      department: { select: { id: true, name: true } },
    },
  },
} as const

export const PLACEMENT_DRIVE_SELECT = {
  id: true,
  companyName: true,
  role: true,
  eligibilityCriteria: true,
  driveDate: true,
  packageOffered: true,
  createdAt: true,
  applications: {
    select: {
      id: true,
      status: true,
      createdAt: true,
      student: { select: { id: true, name: true, regno: true, departmentId: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} as const

export const CERTIFICATE_SELECT = {
  id: true,
  type: true,
  issuedAt: true,
  fileUrl: true,
  student: { select: { id: true, name: true, regno: true } },
} as const

/* ── Placement pipeline ─────────────────────────────────────────────────────── */

export const APPLICATION_STATUSES = [
  'APPLIED',
  'SHORTLISTED',
  'SELECTED',
  'REJECTED',
  'WITHDRAWN',
] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(value)
}

export function asApplicationStatus(value: unknown): ApplicationStatus {
  return isApplicationStatus(value) ? value : 'APPLIED'
}

/** Display order in the pipeline funnel — terminal states last. */
const APPLICATION_RANK: Record<ApplicationStatus, number> = {
  SELECTED: 0,
  SHORTLISTED: 1,
  APPLIED: 2,
  REJECTED: 3,
  WITHDRAWN: 4,
}

export function applicationRank(value: unknown): number {
  return APPLICATION_RANK[asApplicationStatus(value)]
}

export const APPLICATION_STATUS_STYLE: Record<
  ApplicationStatus,
  { label: string; chip: string }
> = {
  APPLIED: { label: 'Applied', chip: 'bg-background text-muted' },
  SHORTLISTED: { label: 'Shortlisted', chip: 'bg-accent-soft text-accent' },
  SELECTED: { label: 'Selected', chip: 'bg-success-soft text-success' },
  REJECTED: { label: 'Rejected', chip: 'bg-danger-soft text-danger' },
  WITHDRAWN: { label: 'Withdrawn', chip: 'bg-background text-subtle' },
}

export interface PipelineTally {
  applied: number
  shortlisted: number
  selected: number
  rejected: number
  withdrawn: number
  total: number
  /** Percent of *decided* outcomes that were offers. Zero total → 0, never NaN. */
  offerRate: number
}

export function tallyApplications(
  applications: { status: string }[]
): PipelineTally {
  const tally: PipelineTally = {
    applied: 0,
    shortlisted: 0,
    selected: 0,
    rejected: 0,
    withdrawn: 0,
    total: applications.length,
    offerRate: 0,
  }
  for (const a of applications) {
    const status = asApplicationStatus(a.status)
    if (status === 'APPLIED') tally.applied += 1
    else if (status === 'SHORTLISTED') tally.shortlisted += 1
    else if (status === 'SELECTED') tally.selected += 1
    else if (status === 'REJECTED') tally.rejected += 1
    else tally.withdrawn += 1
  }
  const decided = tally.selected + tally.rejected
  tally.offerRate = decided === 0 ? 0 : Math.round((tally.selected / decided) * 100)
  return tally
}

export async function countCertificatesByType(
  prisma: PrismaClient,
  collegeId: string
): Promise<Record<string, number>> {
  const grouped = await prisma.certificate.groupBy({
    by: ['type'],
    where: { collegeId },
    _count: { _all: true },
  })
  return grouped.reduce<Record<string, number>>((acc, row) => {
    acc[row.type] = row._count._all
    return acc
  }, {})
}
