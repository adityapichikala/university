import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in · Apex University ERP' }

export default function LoginPage() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-10">
      {/* Soft indigo wash — accent used sparingly, never as a background fill. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-accent/5 blur-3xl"
      />
      <LoginForm />
    </main>
  )
}
