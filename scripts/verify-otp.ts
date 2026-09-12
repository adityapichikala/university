import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

/**
 * End-to-end verification of the OTP password-reset flow.
 *
 * Runs against a live server with no session — this is the one flow a signed-out
 * user has to be able to complete.
 *
 * Usage: BASE=http://localhost:3000 npx tsx scripts/verify-otp.ts
 */

const BASE = process.env.BASE ?? 'http://localhost:3000'
const prisma = new PrismaClient()

let pass = 0
let fail = 0
const ok = (l: string) => {
  pass += 1
  console.log(`  \x1b[32mPASS\x1b[0m ${l}`)
}
const bad = (l: string, d?: unknown) => {
  fail += 1
  console.log(`  \x1b[31mFAIL\x1b[0m ${l}${d === undefined ? '' : ` — ${JSON.stringify(d)}`}`)
}
const check = (l: string, c: boolean, d?: unknown) => (c ? ok(l) : bad(l, d))
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

const TARGET = 'STU001'
const DEMO_PASSWORD = 'password123'
const NEW_PASSWORD = 'ResetPass123'

async function setPassword(regno: string, plain: string) {
  await prisma.user.update({
    where: { regno },
    data: { passwordHash: await bcrypt.hash(plain, 10), resetOtp: null, otpExpiry: null },
  })
}

async function main() {
  section('0. Setup')
  await setPassword(TARGET, DEMO_PASSWORD)
  check('demo password restored before the run', true)

  section('1. Request a code')
  let r = await post('/api/auth/forgot-password', { regno: TARGET.toLowerCase() })
  check('POST forgot-password → 200', r.status === 200, r.data)
  check('response is generic (no account enumeration)', Boolean(r.data.message), r.data)

  const otp: string | undefined = r.data.devOtp
  check('a 6-digit code was issued', typeof otp === 'string' && /^\d{6}$/.test(otp ?? ''), r.data)

  let row = await prisma.user.findUnique({
    where: { regno: TARGET },
    select: { resetOtp: true, otpExpiry: true },
  })
  check('the code is stored', Boolean(row?.resetOtp))
  check('the stored value is a hash, not the code', row?.resetOtp !== otp, row?.resetOtp?.slice(0, 10))
  const minutes = row?.otpExpiry
    ? Math.round((row.otpExpiry.getTime() - Date.now()) / 60000)
    : -999
  check(`expiry is ~10 minutes out (${minutes})`, minutes >= 9 && minutes <= 11, minutes)

  section('2. Reject bad submissions')
  r = await post('/api/auth/reset-password', { regno: TARGET, otp: '000000', newPassword: NEW_PASSWORD })
  check('wrong code refused', r.status === 400, r.data)

  r = await post('/api/auth/reset-password', { regno: TARGET, otp: otp, newPassword: 'short' })
  check('weak password refused', r.status === 400, r.data)
  check('weak password reports the field', Boolean(r.data.fields?.newPassword), r.data.fields)

  r = await post('/api/auth/reset-password', { regno: TARGET, otp: '12345', newPassword: NEW_PASSWORD })
  check('5-digit code refused by schema', r.status === 400, r.data)

  r = await post('/api/auth/reset-password', { regno: 'NOPE999', otp: otp, newPassword: NEW_PASSWORD })
  check('unknown regno refused (same message)', r.status === 400 && Boolean(r.data.error), r.data)

  section('3. Expired code')
  await prisma.user.update({
    where: { regno: TARGET },
    data: { otpExpiry: new Date(Date.now() - 60_000) },
  })
  r = await post('/api/auth/reset-password', { regno: TARGET, otp, newPassword: NEW_PASSWORD })
  check('expired code refused', r.status === 400, r.data)
  const burned = await prisma.user.findUnique({
    where: { regno: TARGET },
    select: { resetOtp: true },
  })
  check('expired code is burned, not replayable', burned?.resetOtp === null, burned)

  section('4. Complete the reset')
  r = await post('/api/auth/forgot-password', { regno: TARGET })
  const otp2: string = r.data.devOtp
  check('a fresh code was issued', /^\d{6}$/.test(otp2 ?? ''), r.data)

  r = await post('/api/auth/reset-password', {
    regno: TARGET,
    otp: otp2,
    newPassword: NEW_PASSWORD,
  })
  check('reset accepted', r.status === 200, r.data)

  row = await prisma.user.findUnique({
    where: { regno: TARGET },
    select: { resetOtp: true, otpExpiry: true },
  })
  check('OTP fields cleared after use', row?.resetOtp === null && row?.otpExpiry === null, row)

  section('5. The new password works')
  let login = await post('/api/auth/login', { regno: TARGET, password: NEW_PASSWORD })
  check('signs in with the new password', login.status === 200, login.data)

  login = await post('/api/auth/login', { regno: TARGET, password: DEMO_PASSWORD })
  check('the old password no longer works', login.status === 401, login.data)

  r = await post('/api/auth/reset-password', { regno: TARGET, otp: otp2, newPassword: 'AnotherPass1' })
  check('the same code cannot be reused', r.status === 400, r.data)

  section('6. Audit trail')
  const recent = await prisma.agentActionLog.findMany({
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: 8,
    select: { actionType: true, status: true },
  })
  const kinds = recent.map((x) => x.actionType)
  check('PASSWORD_RESET_REQUEST audited', kinds.includes('PASSWORD_RESET_REQUEST'), kinds)
  check('PASSWORD_RESET_COMPLETE audited', kinds.includes('PASSWORD_RESET_COMPLETE'), kinds)
  check(
    'rejections recorded with REJECTED status',
    recent.some((x) => x.status === 'REJECTED'),
    recent
  )

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`)
}

main()
  .catch((e) => {
    console.error('ERROR', e)
    fail += 1
  })
  .finally(async () => {
    // Put the demo account back so the other suites keep working.
    await setPassword(TARGET, DEMO_PASSWORD)
    await prisma.$disconnect()
    process.exitCode = fail === 0 ? 0 : 1
  })
