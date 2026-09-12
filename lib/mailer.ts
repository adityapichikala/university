import nodemailer from 'nodemailer'

/**
 * Outbound mail.
 *
 * Delivery needs credentials this project does not carry around, so the
 * transport is configured from the environment and degrades to a console log
 * when it is absent. That keeps the reset flow fully exercisable in dev — and
 * it means a missing SMTP setting fails loudly in the logs instead of silently
 * swallowing someone's password reset.
 *
 * Set these to actually send:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
 */

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export interface MailResult {
  sent: boolean
  /** 'smtp' when it really went out, 'console' when it was only logged. */
  transport: 'smtp' | 'console'
  error?: string
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST)
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (!smtpConfigured()) {
    // Deliberate: the code is visible here so a developer can complete the
    // flow. It never leaves the server process.
    console.info(
      `[mailer] no SMTP_HOST configured — would send to ${message.to}\n` +
        `  subject: ${message.subject}\n${message.text}`
    )
    return { sent: false, transport: 'console' }
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
        : undefined,
    })

    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? 'no-reply@apex.edu',
      to: message.to,
      subject: message.subject,
      text: message.text,
    })

    return { sent: true, transport: 'smtp' }
  } catch (error) {
    // Mail is best-effort: the OTP is already stored, so report the failure and
    // let the caller decide rather than losing the reset request.
    const message2 = error instanceof Error ? error.message : String(error)
    console.error('[mailer] send failed:', message2)
    return { sent: false, transport: 'smtp', error: message2 }
  }
}

/** The reset email body. `minutes` comes from OTP_TTL_MINUTES. */
export function resetPasswordEmail(
  name: string,
  otp: string,
  minutes: number
): { subject: string; text: string } {
  return {
    subject: 'Your Apex University password reset code',
    text:
      `Hello ${name},\n\n` +
      `Your password reset code is ${otp}\n\n` +
      `It expires in ${minutes} minutes. If you did not request a reset, ` +
      `you can ignore this email — your password has not changed.\n\n` +
      `— Apex University ERP`,
  }
}
