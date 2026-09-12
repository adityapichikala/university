'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  OTP_LENGTH,
  fieldErrors,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '@/lib/password-reset'

/**
 * Two-step reset.
 *
 * Client-side Zod gives an instant message; the server re-validates with the
 * same schema, so this is a convenience and never the actual gate.
 */

type Step = 'request' | 'verify'

const BRAND = (
  <div className="mb-7 flex items-center gap-3">
    <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary">
      <span className="material-symbols-outlined !text-[22px] text-white">school</span>
    </div>
    <div>
      <p className="font-heading text-base font-bold leading-tight text-primary">Apex University</p>
      <p className="font-mono text-[11px] uppercase tracking-wider text-subtle">Campus ERP</p>
    </div>
  </div>
)

export function ForgotPasswordForm() {
  const [step, setStep] = useState<Step>('request')
  const [regno, setRegno] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }

  async function requestCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFields({})

    const parsed = forgotPasswordSchema.safeParse({ regno })
    if (!parsed.success) {
      setFields(fieldErrors(parsed.error))
      return
    }

    setLoading(true)
    try {
      const { status, data } = await post('/api/auth/forgot-password', {
        regno: parsed.data.regno,
      })
      if (status !== 200) {
        setError(data?.error ?? 'Could not send the code')
        return
      }
      setRegno(parsed.data.regno)
      setStep('verify')
      setNotice(
        data.devOtp
          ? `No mail server is configured, so the code is shown here: ${data.devOtp}`
          : data.message
      )
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function submitReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFields({})

    const parsed = resetPasswordSchema.safeParse({ regno, otp, newPassword })
    if (!parsed.success) {
      setFields(fieldErrors(parsed.error))
      return
    }

    setLoading(true)
    try {
      const { status, data } = await post('/api/auth/reset-password', parsed.data)
      if (status !== 200) {
        setError(data?.error ?? 'Could not reset the password')
        if (data?.fields) setFields(data.fields)
        return
      }
      setStep('request')
      setOtp('')
      setNewPassword('')
      setNotice('Password updated. Sign in with your new password.')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative w-full max-w-[420px]">
      <div className="rounded-xl border border-border bg-surface p-8 shadow-card">
        {BRAND}

        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          {step === 'request' ? 'Forgot password' : 'Enter reset code'}
        </h1>
        <p className="mt-1 mb-6 text-sm text-muted">
          {step === 'request'
            ? 'Enter your registration number and we will email a reset code.'
            : `We sent a ${OTP_LENGTH}-digit code for ${regno}. It expires in 10 minutes.`}
        </p>

        <form onSubmit={step === 'request' ? requestCode : submitReset} className="space-y-4">
          <div>
            <Label htmlFor="regno">Registration Number</Label>
            <Input
              id="regno"
              className="num uppercase"
              placeholder="STU001"
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              value={regno}
              onChange={(e) => setRegno(e.target.value)}
              disabled={step === 'verify'}
              required
            />
            {fields.regno ? <FieldError message={fields.regno} /> : null}
          </div>

          {step === 'verify' ? (
            <>
              <div>
                <Label htmlFor="otp">Reset code</Label>
                <Input
                  id="otp"
                  className="num"
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={OTP_LENGTH}
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  required
                />
                {fields.otp ? <FieldError message={fields.otp} /> : null}
              </div>

              <div>
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                {fields.newPassword ? (
                  <FieldError message={fields.newPassword} />
                ) : (
                  <p className="mt-1 text-xs text-subtle">
                    8+ characters, with upper and lower case and a number.
                  </p>
                )}
              </div>
            </>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger"
            >
              <span className="material-symbols-outlined !text-[18px] leading-5">error</span>
              <span>{error}</span>
            </div>
          ) : null}

          {notice ? (
            <div className="flex items-start gap-2 rounded-xl bg-success-soft px-3.5 py-3 text-sm text-success">
              <span className="material-symbols-outlined !text-[18px] leading-5">check_circle</span>
              <span>{notice}</span>
            </div>
          ) : null}

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
            {loading
              ? 'Working…'
              : step === 'request'
                ? 'Send reset code'
                : 'Reset password'}
          </Button>
        </form>

        {step === 'verify' ? (
          <button
            type="button"
            onClick={() => {
              setStep('request')
              setOtp('')
              setNewPassword('')
              setNotice(null)
            }}
            className="mt-3 w-full text-center text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
          >
            Use a different registration number
          </button>
        ) : null}
      </div>

      <p className="mt-5 text-center text-sm text-muted">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to Login
        </Link>
      </p>
    </div>
  )
}

function FieldError({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-1 text-xs text-danger">
      {message}
    </p>
  )
}
