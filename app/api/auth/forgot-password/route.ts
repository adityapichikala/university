import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { audit } from '@/lib/audit'
import {
  OTP_TTL_MINUTES,
  forgotPasswordSchema,
  generateOtp,
  hashOtp,
  otpExpiryFrom,
} from '@/lib/password-reset'
import { resetPasswordEmail, sendMail } from '@/lib/mailer'

/**
 * POST /api/auth/forgot-password — step 1: issue a reset code.
 *
 * The response is identical whether or not the registration number exists.
 * Telling the two apart would let anyone enumerate the college's members, which
 * is a worse problem than a slightly confusing message.
 */

const GENERIC_OK = {
  ok: true,
  message: 'If that registration number exists, a reset code has been sent to its email.',
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = forgotPasswordSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
  }

  const regno = parsed.data.regno.toUpperCase()

  const user = await prisma.user.findUnique({
    where: { regno },
    select: { id: true, name: true, email: true, status: true, collegeId: true },
  })

  // Unknown number: audit it (a pattern of these is worth seeing) but answer
  // exactly as we would for a real one.
  if (!user) {
    await audit({
      agentName: 'auth',
      actionType: 'PASSWORD_RESET_REQUEST',
      targetEntity: 'User',
      status: 'REJECTED',
      after: { regno: regno.slice(0, 24), reason: 'unknown_regno' },
    })
    return NextResponse.json(GENERIC_OK)
  }

  if (user.status !== 'ACTIVE') {
    await audit({
      agentName: 'auth',
      actionType: 'PASSWORD_RESET_REQUEST',
      targetEntity: 'User',
      entityId: user.id,
      status: 'REJECTED',
      collegeId: user.collegeId,
      after: { regno, reason: 'inactive' },
    })
    return NextResponse.json(GENERIC_OK)
  }

  const otp = generateOtp()
  const otpExpiry = otpExpiryFrom()

  await prisma.user.update({
    where: { id: user.id },
    // Only the hash is stored; overwriting any previous code invalidates it,
    // so a user can only ever have one live reset.
    data: { resetOtp: await hashOtp(otp), otpExpiry },
  })

  const mail = resetPasswordEmail(user.name, otp, OTP_TTL_MINUTES)
  const result = await sendMail({ to: user.email, ...mail })

  await audit({
    agentName: 'auth',
    actionType: 'PASSWORD_RESET_REQUEST',
    targetEntity: 'User',
    entityId: user.id,
    collegeId: user.collegeId,
    status: result.sent ? 'EXECUTED' : 'PENDING',
    after: { regno, transport: result.transport, expiresAt: otpExpiry.toISOString() },
  })

  // Dev only: without SMTP there is no way to read the code, so it is echoed
  // back to make the flow testable. Never in production.
  const devOtp =
    process.env.NODE_ENV === 'production' || result.transport === 'smtp' ? undefined : otp

  return NextResponse.json({ ...GENERIC_OK, ...(devOtp ? { devOtp } : {}) })
}
