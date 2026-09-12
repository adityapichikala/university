/**
 * Task #75 verification — proves the post-login redirect is derived from the
 * user's `role` column, not inferred from the registration-number prefix.
 *
 * The seeded fixtures can't prove this on their own: every seeded regno prefix
 * already agrees with its role (STU001/STUDENT, WDN001/WARDEN, ...), so a
 * prefix-sniffing implementation and a role-reading one produce identical
 * output. This script manufactures the counterexample — two users whose prefix
 * and role deliberately contradict each other — and asserts the redirect
 * follows the role.
 *
 * Temporary users are removed in a `finally` block so a mid-run failure can't
 * leave test accounts behind in the dev database.
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/db'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const PASSWORD = 'password123'

/** regno prefix suggests one role, the `role` column says another. */
const CASES = [
  { regno: 'STU999', role: 'WARDEN', expect: '/dashboard/warden' },
  { regno: 'WDN999', role: 'STUDENT', expect: '/dashboard/student' },
  { regno: 'ZZZ999', role: 'FINANCE', expect: '/dashboard/finance' },
]

async function login(regno: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regno, password: PASSWORD }),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** Clears any probe users left behind, plus the audit rows blocking their delete. */
async function removeProbes() {
  const probes = await prisma.user.findMany({
    where: { regno: { in: CASES.map((c) => c.regno) } },
    select: { id: true },
  })
  const ids = probes.map((p) => p.id)
  if (ids.length === 0) return { logs: 0, users: 0 }

  // A successful login writes an AgentActionLog row referencing the user, and
  // that FK is `onDelete: Restrict` by design (the schema treats users as
  // immutable). So the audit rows have to be cleared before the users.
  const logs = await prisma.agentActionLog.deleteMany({
    where: { approvedByUserId: { in: ids } },
  })
  const users = await prisma.user.deleteMany({ where: { id: { in: ids } } })
  return { logs: logs.count, users: users.count }
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const college = await prisma.college.findFirst({ select: { id: true } })
  if (!college) throw new Error('no college seeded — run the seed first')

  // Leftovers from an aborted run would collide on the unique regno.
  await removeProbes()

  let failures = 0

  try {
    for (const c of CASES) {
      await prisma.user.create({
        data: {
          regno: c.regno,
          name: `Redirect Probe ${c.regno}`,
          email: `${c.regno.toLowerCase()}@probe.invalid`,
          passwordHash,
          role: c.role,
          collegeId: college.id,
          status: 'ACTIVE',
        },
      })

      const { status, body } = await login(c.regno)
      const actual = body.redirect
      const ok = status === 200 && actual === c.expect
      if (!ok) failures++

      console.log(
        `${ok ? 'PASS' : 'FAIL'}  regno=${c.regno} (prefix suggests ` +
          `${c.regno.slice(0, 3)}) role=${c.role}\n` +
          `      expected redirect=${c.expect}\n` +
          `      actual   redirect=${actual}  http=${status}`
      )
    }
  } finally {
    const { logs, users } = await removeProbes()
    console.log(`\ncleanup: removed ${logs} audit row(s), ${users} probe user(s)`)
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
