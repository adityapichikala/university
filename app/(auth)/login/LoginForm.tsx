'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm() {
  const router = useRouter()
  const [regno, setRegno] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regno, password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data?.error ?? 'Unable to sign in')
        return
      }

      // Middleware + requireUser() both re-verify; this is just the happy path.
      router.replace(data.redirect)
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative w-full max-w-[420px]">
      <div className="rounded-xl border border-border bg-surface p-8 shadow-card">
        {/* Brand */}
        <div className="mb-7 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary">
            <span className="material-symbols-outlined !text-[22px] text-white">school</span>
          </div>
          <div>
            <p className="font-heading text-base font-bold leading-tight text-primary">
              Apex University
            </p>
            <p className="font-mono text-[11px] uppercase tracking-wider text-subtle">
              Campus ERP
            </p>
          </div>
        </div>

        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">Sign in</h1>
        <p className="mt-1 mb-6 text-sm text-muted">
          Use your registration number to access your dashboard.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="regno">Registration Number</Label>
            <Input
              id="regno"
              name="regno"
              className="num uppercase"
              placeholder="STU001"
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              value={regno}
              onChange={(e) => setRegno(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger"
            >
              <span className="material-symbols-outlined !text-[18px] leading-5">error</span>
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>

      {/* Seeded demo accounts */}
      <div className="mt-5 rounded-xl border border-border bg-surface/60 p-4">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-subtle">
          Demo accounts
        </p>
        <ul className="space-y-1 text-xs text-muted">
          {[
            ['STU001', 'Student'],
            ['TCH001', 'Teacher'],
            ['ADM001', 'Admin'],
          ].map(([id, role]) => (
            <li key={id} className="flex items-center justify-between">
              <span className="num text-foreground">{id}</span>
              <span>
                {role} · <span className="num text-muted">password123</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
