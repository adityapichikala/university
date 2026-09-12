import type { Metadata } from 'next'
import { ForgotPasswordForm } from './ForgotPasswordForm'

export const metadata: Metadata = { title: 'Forgot password · Apex University ERP' }

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <ForgotPasswordForm />
    </main>
  )
}
