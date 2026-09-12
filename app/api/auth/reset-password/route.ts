import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { audit } from '@/lib/audit'
import { fieldErrors, resetPasswordSchema, verifyOtp } from '@/lib/password-reset'

/**
 * POST /api/auth/reset-password — step 2: trade the code for a new password.
 *
 * Order matters: expiry is checked before the bcrypt comparison so a stale code
 * is refused without paying for a hash, and a wrong code is refused before any
 * write. The code is cleared on success however it ends — one code, one use.
 */

/** Same message for "no such user", "no code issued" and "wrong code". */
const REJECTED = 'That code is not valid or has expired. Request a new one.'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = resetPasswordSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request payload', fields: fieldErrors(parsed.error) },
      { status: 400 }
    )
  }

  const { otp, newPassword } = parsed.data
  const regno = parsed.data.regno.toUpperCase()

  const user = await prisma.user.findUnique({
    where: { regno },
    select: { id: true, regno: true, role: true, status: true, collegeId: true, resetOtp: true, otpExpiry: true },
  })

  if (!user || !user.resetOtp || !user.otpExpiry) {
    await audit({
      agentName: 'auth',
      actionType: 'PASSWORD_RESET_COMPLETE',
      targetEntity: 'User',
      entityId: user?.id,
      status: 'REJECTED',
      collegeId: user?.collegeId,
      after: { regno, reason: user ? 'no_code_issued' : 'unknown_regno' },
    })
    return NextResponse.json({ error: REJECTED }, { status: 400 })
  }

  if (user.otpExpiry.getTime() < Date.now()) {
    // Burn the expired code so it cannot be replayed if the clock ever moves.
    await prisma.user.update({
      where: { id: user.id },
      data: { resetOtp: null, otpExpiry: null },
    })
    await audit({
      agentName: 'auth',
      actionType: 'PASSWORD_RESET_COMPLETE',
      targetEntity: 'User',
      entityId: user.id,
      status: 'REJECTED',
      collegeId: user.collegeId,
      after: { regno, reason: 'expired' },
    })
    return NextResponse.json({ error: REJECTED }, { status: 400 })
  }

  const matches = await verifyOtp(otp, user.resetOtp)
  if (!matches) {
    await audit({
      agentName: 'auth',
      actionType: 'PASSWORD_RESET_COMPLETE',
      targetEntity: 'User',
      entityId: user.id,
      status: 'REJECTED',
      collegeId: user.collegeId,
      after: { regno, reason: 'wrong_code' },
    })
    return NextResponse.json({ error: REJECTED }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 10),
      resetOtp: null,
      otpExpiry: null,
    },
  })

  await audit({
    agentName: 'auth',
    actionType: 'PASSWORD_RESET_COMPLETE',
    targetEntity: 'User',
    entityId: user.id,
    collegeId: user.collegeId,
    after: { regno },
  })

  return NextResponse.json({ ok: true, message: 'Password updated. You can sign in now.' })
}
