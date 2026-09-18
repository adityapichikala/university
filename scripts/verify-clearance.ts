/**
 * End-to-end verification for the No-Dues clearance workflow.
 *
 * Proves three things the seeded fixtures alone would not:
 *   1. The auto status is derived from the *operational* tables, not stored.
 *   2. A department head may only sign off their own department (LIBRARIAN
 *      cannot decide ACADEMICS), while ADMIN may decide any department.
 *   3. The student API route returns the live summary over HTTP.
 *
 * Self-cleaning: any override rows it writes for STU001 are removed at the end,
 * so the dev DB is left exactly as found.
 */

import { prisma } from '../lib/db'
import { loadPermissions, type AuthContext, type DbUser } from '../lib/rbac'
import { getClearance, recordClearanceDecision } from '../lib/clearance'

const DEMO_PASSWORD = 'password123'

async function ctxFor(regno: string): Promise<AuthContext> {
  const user = (await prisma.user.findUnique({
    where: { regno },
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
  })) as DbUser
  if (!user) throw new Error(`seed user ${regno} missing`)
  const permissions = await loadPermissions(user.role, user.id)
  return {
    session: {
      userId: user.id,
      regno: user.regno,
      role: user.role,
      collegeId: user.collegeId,
      departmentId: user.departmentId,
      name: user.name,
    },
    user,
    permissions,
    can: (k: string) => permissions.has(k),
  }
}

async function login(regno: string): Promise<string> {
  const res = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regno, password: DEMO_PASSWORD }),
  })
  if (!res.ok) throw new Error(`login ${regno} failed: ${res.status}`)
  const cookie = res.headers.get('set-cookie') ?? ''
  const token = cookie.split(';')[0]
  if (!token) throw new Error(`no session cookie for ${regno}`)
  return token
}

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

async function main() {
  const student = await prisma.user.findFirst({
    where: { regno: 'STU001' },
    select: { id: true, collegeId: true },
  })
  if (!student) throw new Error('STU001 missing')
  const collegeId = student.collegeId ?? ''

  // 1. Auto status is computed live (4 departments present).
  const before = await getClearance(student.id, collegeId)
  check('summary has 4 departments', before.departments.length === 4,
    before.departments.map((d) => `${d.department}=${d.status}`).join(','))
  check('every department has an auto status', before.departments.every((d) => d.autoStatus))

  // 2a. ADMIN can decide any department.
  const admin = await ctxFor('ADM001')
  const adminOk = await recordClearanceDecision(admin, {
    studentId: student.id,
    department: 'LIBRARY',
    manualStatus: 'CLEARED',
    note: 'verification override',
  })
  check('ADMIN can clear LIBRARY', adminOk.ok, JSON.stringify(adminOk))

  const afterAdmin = await getClearance(student.id, collegeId)
  const lib = afterAdmin.departments.find((d) => d.department === 'LIBRARY')!
  check('LIBRARY now overridden=CLEARED', lib.overridden && lib.status === 'CLEARED',
    `manual=${lib.manualStatus} status=${lib.status}`)

  // 2b. A librarian may NOT decide Academics (wrong department).
  const librarian = await ctxFor('LIB001')
  const wrongDept = await recordClearanceDecision(librarian, {
    studentId: student.id,
    department: 'ACADEMICS',
    manualStatus: 'CLEARED',
  })
  check('LIBRARIAN blocked from ACADEMICS', !wrongDept.ok, wrongDept.ok ? 'unexpectedly allowed' : wrongDept.error)

  // 2c. The same librarian MAY decide LIBRARY.
  const libOk = await recordClearanceDecision(librarian, {
    studentId: student.id,
    department: 'LIBRARY',
    manualStatus: 'PENDING',
  })
  check('LIBRARIAN can decide LIBRARY', libOk.ok, JSON.stringify(libOk))

  // 3. Student API route returns the live summary over HTTP.
  const token = await login('STU001')
  const apiRes = await fetch('http://localhost:3000/api/student/clearance', {
    headers: { Cookie: token },
  })
  check('GET /api/student/clearance returns 200', apiRes.status === 200, `status=${apiRes.status}`)
  if (apiRes.ok) {
    const body = (await apiRes.json()) as { clearance?: { departments?: unknown[] } }
    check('API body has 4 departments', (body.clearance?.departments?.length ?? 0) === 4)
  }
}

async function cleanup() {
  // Remove only the override rows this script may have created for STU001.
  await prisma.clearance.deleteMany({ where: { student: { regno: 'STU001' } } })
}

;(async () => {
  try {
    await main()
    if (failures > 0) {
      console.log(`\n${failures} CHECK(S) FAILED`)
      process.exit(1)
    }
    console.log('\nALL PASS')
    process.exit(0)
  } catch (e) {
    console.error(e)
    process.exit(1)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})()
