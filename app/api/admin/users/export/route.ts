import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { audit } from '@/lib/audit'
import {
  contentDisposition,
  csvFile,
  pdfFile,
  type CsvColumn,
  type PdfColumn,
} from '@/lib/export-utils'

/**
 * GET /api/admin/users/export — a complete user register.
 *
 * `?format=csv|pdf` (default csv), plus optional `?role=STUDENT&status=ACTIVE`
 * so the export matches the filter the admin has on screen.
 *
 * This is the authoritative export: it reads every matching row, not just the
 * page the browser rendered. Two consequences the code below is careful about:
 *
 *   1. `passwordHash` is never selected. Not "selected then stripped" — never
 *      read, so it cannot reach a response body through a later refactor.
 *   2. The export is audited. A full register of names and emails leaving the
 *      system is exactly the event a governance log exists to record.
 */

const MAX_ROWS = 5000

export async function GET(req: NextRequest) {
  // Same permission as the user list — an export is not a lesser read.
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response

  const url = new URL(req.url)
  const format = url.searchParams.get('format') === 'pdf' ? 'pdf' : 'csv'
  const role = url.searchParams.get('role')?.trim().toUpperCase() || null
  const status = url.searchParams.get('status')?.trim().toUpperCase() || null

  // Allow-list: an unknown ?role= must not silently return everyone, and must
  // not throw. Treat it as "not a valid filter" rather than guessing.
  const roleFilter = role && /^[A-Z_]{2,20}$/.test(role) ? role : null
  const statusFilter = status && /^[A-Z_]{2,20}$/.test(status) ? status : null

  const users = await prisma.user.findMany({
    where: {
      ...scopes.college(result.ctx),
      ...(roleFilter ? { role: roleFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    // Deliberately NO passwordHash, resetOtp or otpExpiry.
    select: {
      regno: true,
      name: true,
      email: true,
      role: true,
      status: true,
      rollNo: true,
      createdAt: true,
      department: { select: { name: true } },
      class: { select: { name: true } },
    },
    orderBy: [{ role: 'asc' }, { regno: 'asc' }],
    take: MAX_ROWS,
  })

  const rows = users.map((u) => ({
    regno: u.regno,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    department: u.department?.name ?? '',
    section: u.class?.name ?? '',
    rollNo: u.rollNo ?? '',
    joined: u.createdAt.toISOString().slice(0, 10),
  }))

  const scope = [
    roleFilter ? `role ${roleFilter}` : 'all roles',
    statusFilter ? `status ${statusFilter}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  await audit({
    ctx: result.ctx,
    agentName: 'admin',
    actionType: 'USER_EXPORT',
    targetEntity: 'User',
    after: { format, rows: rows.length, filters: scope },
  })

  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'No users match those filters', rows: 0 },
      { status: 404 }
    )
  }

  const file =
    format === 'pdf'
      ? pdfFile(rows, PDF_COLUMNS, {
          title: 'User register',
          subtitle: `${rows.length} user(s) · ${scope} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
          basename: 'users',
        })
      : csvFile(rows, CSV_COLUMNS, 'users')

  return new NextResponse(file.body, {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': contentDisposition(file.filename),
      // An export is a point-in-time snapshot — never let a proxy serve a stale one.
      'Cache-Control': 'no-store',
    },
  })
}

type Row = {
  regno: string
  name: string
  email: string
  role: string
  status: string
  department: string
  section: string
  rollNo: string
  joined: string
}

const CSV_COLUMNS: CsvColumn<Row>[] = [
  { header: 'Reg no.', value: (r) => r.regno },
  { header: 'Name', value: (r) => r.name },
  { header: 'Email', value: (r) => r.email },
  { header: 'Role', value: (r) => r.role },
  { header: 'Status', value: (r) => r.status },
  { header: 'Department', value: (r) => r.department },
  { header: 'Section', value: (r) => r.section },
  { header: 'Roll no.', value: (r) => r.rollNo },
  { header: 'Joined', value: (r) => r.joined },
]

// Roles and statuses are short fixed vocabularies; emails and names want room.
const PDF_COLUMNS: PdfColumn<Row>[] = [
  { header: 'Reg no.', value: (r) => r.regno, weight: 1 },
  { header: 'Name', value: (r) => r.name, weight: 1.6 },
  { header: 'Email', value: (r) => r.email, weight: 2.2 },
  { header: 'Role', value: (r) => r.role, weight: 1 },
  { header: 'Status', value: (r) => r.status, weight: 0.9 },
  { header: 'Department', value: (r) => r.department, weight: 1.4 },
  { header: 'Section', value: (r) => r.section, weight: 0.9 },
]
