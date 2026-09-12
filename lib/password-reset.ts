import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

/**
 * Password reset — the rules shared by the API routes and the form.
 *
 * The Zod schemas live here, not in a route file, because the client validates
 * for a fast error message and the server validates for real. Two copies would
 * drift; one import cannot.
 */

export const OTP_LENGTH = 6
/** How long a code stays valid. Ten minutes is long enough to check a mailbox. */
export const OTP_TTL_MINUTES = 10

/**
 * New passwords: 8+ characters across three character classes.
 * Note this is stricter than the seeded demo passwords on purpose — a reset is
 * the moment to raise the bar, and existing accounts are not forced to change.
 */
export const newPasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200, 'That password is too long')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number')

export const forgotPasswordSchema = z.object({
  regno: z.string().trim().min(1, 'Registration number is required').max(64),
})

export const resetPasswordSchema = z.object({
  regno: z.string().trim().min(1, 'Registration number is required').max(64),
  otp: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`),
  newPassword: newPasswordSchema,
})

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

/** Turn Zod issues into the `{ field: message }` shape the form renders. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !out[key]) out[key] = issue.message
  }
  return out
}

/* ── OTP ───────────────────────────────────────────────────────────────────── */

/**
 * Cryptographically random six digits.
 *
 * `randomInt` rather than `Math.random` — a guessable reset code is worse than
 * no reset code. Zero-padded so "000042" survives being stored as text.
 */
export function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
}

export function otpExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_TTL_MINUTES * 60_000)
}

/** Never store the code itself — a database leak must not reveal live codes. */
export function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10)
}

export function verifyOtp(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash)
}
