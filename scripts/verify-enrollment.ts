import { PrismaClient } from '@prisma/client'

/**
 * End-to-end verification of the enrollment rules, over real HTTP with a real
 * admin session:
 *   1. 24-credit cap
 *   2. seat availability re-checked inside the transaction (race at capacity)
 *   3. waitlist instead of failure when a section is full
 *   4. timetable clash against the student's CONFIRMED enrollments
 *   5. duplicate enrollment is a 409 the client can treat as success
 *
 * Usage: BASE=http://localhost:3000 npx tsx scripts/verify-enrollment.ts
 */

const BASE = process.env.BASE ?? 'http://localhost:3000'
const prisma = new PrismaClient()

let pass = 0
let fail = 0
function ok(label: string) {
  pass += 1
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`)
}
function bad(label: string, detail?: unknown) {
  fail += 1
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
}
function check(label: string, condition: boolean, detail?: unknown) {
  condition ? ok(label) : bad(label, detail)
}
function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

/* ── HTTP ──────────────────────────────────────────────────────────────────── */

let cookie = ''

async function login(regno: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regno, password }),
  })
  const jar = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
  const session = jar.find((c) => c.startsWith('session='))
  if (session) cookie = session.split(';')[0]
  return res.status
}

async function api(path: string, method: 'POST' | 'DELETE', body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await res.json().catch(() => ({}))
  return { status: res.status, payload }
}

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const TEMP_COURSE_CODE = 'TST900'
/**
 * Test slots are tagged with a room no real timetable uses, so cleanup can
 * remove exactly what it created. Deleting by course code is a trap: it also
 * removes the *seeded* slots for that course and quietly corrupts the demo data.
 */
const TEST_ROOM = 'ZZTEST'

async function cleanup() {
  await prisma.courseEnrollment.deleteMany({
    where: { student: { regno: { startsWith: 'TST' } } },
  })
  await prisma.timetableSlot.deleteMany({ where: { room: TEST_ROOM } })
  await prisma.course.deleteMany({ where: { code: TEMP_COURSE_CODE } })
  await prisma.user.deleteMany({ where: { regno: { startsWith: 'TST' } } })
}

async function makeStudent(regno: string) {
  return prisma.user.create({
    data: {
      regno,
      name: `Test ${regno}`,
      email: `${regno.toLowerCase()}@apex.test`,
      passwordHash: 'x',
      role: 'STUDENT',
      collegeId: COLLEGE_ID,
    },
    select: { id: true },
  })
}

let COLLEGE_ID = ''
let CLASS_ID = ''
let DEPT_ID = ''

async function main() {
  section('0. Setup')
  const college = await prisma.college.findFirst({ select: { id: true } })
  if (!college) throw new Error('no college')
  COLLEGE_ID = college.id

  await cleanup()

  const klass = await prisma.class.findFirst({ select: { id: true, departmentId: true } })
  if (!klass) throw new Error('no class')
  CLASS_ID = klass.id
  DEPT_ID = klass.departmentId

  const status = await login('ADM001', 'password123')
  check('ADM001 logged in', status === 200, status)
  if (status !== 200) throw new Error('login failed')

  const cs501 = await prisma.course.findFirst({ where: { code: 'CS501' }, select: { id: true, credits: true } })
  const cs502 = await prisma.course.findFirst({ where: { code: 'CS502' }, select: { id: true, credits: true } })
  const cs503 = await prisma.course.findFirst({ where: { code: 'CS503' }, select: { id: true, credits: true } })
  if (!cs501 || !cs502 || !cs503) throw new Error('missing seeded courses')

  // A 20-credit course: fits under the cap alone, busts it alongside CS501+CS502.
  const big = await prisma.course.create({
    data: {
      collegeId: COLLEGE_ID,
      departmentId: DEPT_ID,
      code: TEMP_COURSE_CODE,
      name: 'Test Heavy Course',
      credits: 20,
      capacity: 5,
    },
    select: { id: true },
  })

  const s1 = await makeStudent('TST001')
  const s2 = await makeStudent('TST002')
  const s3 = await makeStudent('TST003')
  const s4 = await makeStudent('TST004')
  const s5 = await makeStudent('TST005')

  const enroll = (studentId: string, courseId: string, extra: Record<string, unknown> = {}) =>
    api('/api/enrollments', 'POST', { studentId, courseId, classId: CLASS_ID, ...extra })

  // ── 1. credit cap ────────────────────────────────────────────────────────
  section('1. 24-credit cap')
  let r = await enroll(s1.id, cs501.id)
  check('TST001 → CS501 enrolled', r.status === 201, r.payload)
  r = await enroll(s1.id, cs502.id)
  check('TST001 → CS502 enrolled', r.status === 201, r.payload)
  r = await enroll(s1.id, cs503.id)
  check('TST001 → CS503 enrolled', r.status === 201, r.payload)

  const held = cs501.credits + cs502.credits + cs503.credits
  r = await enroll(s1.id, big.id)
  check(
    `${held} + 20 credits refused (cap 24)`,
    r.status === 409 && r.payload.reason === 'CREDIT_CAP',
    r.payload
  )
  check(
    'refusal reports the numbers',
    r.payload.currentCredits === held && r.payload.limit === 24,
    r.payload
  )

  // ── 2. duplicate → 409 DUPLICATE (client treats as success) ──────────────
  section('2. Idempotent enroll')
  r = await enroll(s1.id, cs501.id)
  check(
    're-enrolling returns 409 DUPLICATE',
    r.status === 409 && r.payload.reason === 'DUPLICATE',
    r.payload
  )
  check('conflict carries the existing status', r.payload.status === 'CONFIRMED', r.payload)

  // ── 3. timetable clash against CONFIRMED enrollments ─────────────────────
  section('3. Slot collision')
  // CS501 holds Mon 09:00–10:00; the big course is Mon 09:30–10:30.
  await prisma.timetableSlot.create({
    data: { collegeId: COLLEGE_ID, courseId: cs501.id, classId: CLASS_ID, dayOfWeek: 1, startTime: '09:00', endTime: '10:00', room: TEST_ROOM },
  })
  await prisma.timetableSlot.create({
    data: { collegeId: COLLEGE_ID, courseId: big.id, classId: CLASS_ID, dayOfWeek: 1, startTime: '09:30', endTime: '10:30', room: TEST_ROOM },
  })

  // s2 holds only CS501 (4) → 4 + 20 = 24, exactly at the cap, so the cap
  // passes and the clash is what stops it.
  r = await enroll(s2.id, cs501.id)
  check('TST002 → CS501 enrolled', r.status === 201, r.payload)
  r = await enroll(s2.id, big.id)
  check(
    'overlapping slot refused',
    r.status === 409 && r.payload.reason === 'SLOT_CLASH',
    r.payload
  )
  check(
    'conflict names the clashing course',
    Array.isArray(r.payload.conflicts) && r.payload.conflicts[0]?.courseCode === 'CS501',
    r.payload.conflicts
  )

  // A WAITLISTED place holds no slot, so it must not block anything.
  // (Checked in section 4 by waitlisting s4 and enrolling it elsewhere.)

  // ── 4. seats, waitlist, promotion ────────────────────────────────────────
  section('4. Seats and waitlist')
  await prisma.course.update({ where: { id: big.id }, data: { capacity: 1 } })

  r = await enroll(s3.id, big.id)
  check('first student takes the only seat', r.status === 201 && r.payload.waitlisted === false, r.payload)

  r = await enroll(s4.id, big.id)
  check(
    'second student refused with SECTION_FULL',
    r.status === 409 && r.payload.reason === 'SECTION_FULL',
    r.payload
  )
  check('refusal offers the waitlist', r.payload.canWaitlist === true, r.payload)
  check('refusal reports seat state', r.payload.seats?.taken === 1 && r.payload.seats?.capacity === 1, r.payload.seats)

  r = await enroll(s4.id, big.id, { joinWaitlist: true })
  check(
    'joining the waitlist succeeds instead of failing',
    r.status === 201 && r.payload.waitlisted === true,
    r.payload
  )
  check('waitlist position reported', r.payload.waitlistPosition === 1, r.payload)

  r = await enroll(s5.id, big.id, { joinWaitlist: true })
  check('second waitlist entry is #2', r.payload.waitlistPosition === 2, r.payload)

  r = await enroll(s4.id, big.id, { joinWaitlist: true })
  check(
    'waitlisting twice is a DUPLICATE, not a second place',
    r.status === 409 && r.payload.reason === 'DUPLICATE' && r.payload.status === 'WAITLISTED',
    r.payload
  )

  // A waitlisted place must not count as a seat or as a clash source.
  const seatsNow = await prisma.courseEnrollment.count({
    where: { courseId: big.id, classId: CLASS_ID, status: 'CONFIRMED' },
  })
  check('waitlist entries do not consume seats', seatsNow === 1, seatsNow)

  // ── 5. race at capacity ──────────────────────────────────────────────────
  section('5. Race at capacity (transaction)')
  await prisma.course.update({ where: { id: big.id }, data: { capacity: 2 } })
  const racers = await Promise.all(
    ['TST006', 'TST007', 'TST008', 'TST009', 'TST010'].map((r2) => makeStudent(r2))
  )

  // One seat left, five students ask at the same time.
  const results = await Promise.all(racers.map((s) => enroll(s.id, big.id)))
  const seated = results.filter((x) => x.status === 201).length
  const full = results.filter((x) => x.status === 409 && x.payload.reason === 'SECTION_FULL').length
  check(`exactly 1 of 5 won the last seat (got ${seated})`, seated === 1, { seated, full })
  check(`the other 4 were told the section is full (got ${full})`, full === 4, { seated, full })

  const confirmedAfter = await prisma.courseEnrollment.count({
    where: { courseId: big.id, classId: CLASS_ID, status: 'CONFIRMED' },
  })
  check(`seats never exceeded capacity (${confirmedAfter}/2)`, confirmedAfter <= 2, confirmedAfter)

  // ── 6. promotion off the waitlist ────────────────────────────────────────
  section('6. Promotion when a seat frees')
  const s3Row = await prisma.courseEnrollment.findFirst({
    where: { studentId: s3.id, courseId: big.id },
    select: { id: true },
  })
  if (!s3Row) throw new Error('s3 enrollment missing')

  // Free s3's seat; the queue should hand it to s4 (position 1).
  const del = await api(`/api/enrollments/${s3Row.id}`, 'DELETE')
  check('withdraw succeeded', del.status === 200, del.payload)
  check(
    'seat passed to the first waitlisted student',
    del.payload.promoted?.regno === 'TST004',
    del.payload
  )

  const s4Row = await prisma.courseEnrollment.findFirst({
    where: { studentId: s4.id, courseId: big.id },
    select: { status: true },
  })
  check('TST004 is now CONFIRMED', s4Row?.status === 'CONFIRMED', s4Row)

  // ── 7. audit ─────────────────────────────────────────────────────────────
  section('7. Audit trail')
  const recent = await prisma.agentActionLog.findMany({
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: 12,
    select: { actionType: true },
  })
  const kinds = recent.map((x) => x.actionType)
  check('ENROLLMENT_CREATE audited', kinds.includes('ENROLLMENT_CREATE'), kinds)
  check('ENROLLMENT_WAITLIST audited', kinds.includes('ENROLLMENT_WAITLIST'), kinds)
  check('ENROLLMENT_DELETE audited', kinds.includes('ENROLLMENT_DELETE'), kinds)

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`)
}

main()
  .catch((e) => {
    console.error('\nERROR', e)
    fail += 1
  })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
    process.exitCode = fail === 0 ? 0 : 1
  })
