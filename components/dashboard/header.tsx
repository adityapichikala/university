'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { NavList } from './nav-list'
import type { NavSection } from './nav-items'

export interface HeaderUser {
  name: string
  regno: string
  email: string
  role: Role
}

interface HeaderProps {
  user: HeaderUser
  sections: NavSection[]
  collegeName?: string | null
  /** Live unread announcements for this user. 0 renders a plain bell. */
  unreadCount?: number
  /** Where the bell points. Omitted for roles without a board page. */
  notificationsHref?: string
}

export function Header({
  user,
  sections,
  collegeName,
  unreadCount = 0,
  notificationsHref,
}: HeaderProps) {
  // Mobile Sheet (Base UI Dialog) + account menu state.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const router = useRouter()

  // No "close on route change" effect needed: NavList closes the Sheet on
  // navigation, and logout closes both overlays explicitly.

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setSheetOpen(false)
    setMenuOpen(false)
    router.replace('/login')
    router.refresh()
  }

  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  /**
   * A student's identity is their registration number. Their role is a row the
   * database resolved for them, not something they act on — so the chrome
   * shows "STU001", never "STU001 · Student". Staff keep the label: for an HOD
   * or an admin, "which role am I signed in as" is a real question when they
   * hold more than one.
   */
  const showRole = user.role !== 'STUDENT'

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur-md lg:px-8">
      {/* ── Mobile navigation Sheet (Base UI Dialog) ─────────────────────────── */}
      <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        <Dialog.Trigger
          aria-label="Open navigation menu"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-foreground hover:bg-background lg:hidden"
        >
          <span className="material-symbols-outlined">menu</span>
        </Dialog.Trigger>

        <Dialog.Portal>
          <Dialog.Backdrop className="animate-fade fixed inset-0 z-40 bg-primary/40" />
          <Dialog.Popup className="animate-sheet fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-surface shadow-lift focus:outline-none">
            <div className="flex h-16 items-center gap-3 border-b border-border px-5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary">
                <span className="material-symbols-outlined !text-[20px] text-white">school</span>
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="truncate font-heading text-sm font-bold leading-tight text-primary">
                  {collegeName ?? 'Apex University'}
                </Dialog.Title>
                <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">
                  Campus ERP
                </p>
              </div>
              <Dialog.Close
                aria-label="Close navigation menu"
                className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-background"
              >
                <span className="material-symbols-outlined">close</span>
              </Dialog.Close>
            </div>

            <nav className="scrollbar-slim flex-1 overflow-y-auto px-3 py-5">
              <NavList sections={sections} onNavigate={() => setSheetOpen(false)} />
            </nav>

            <div className="border-t border-border p-3">
              <div className="mb-2 flex items-center gap-3 rounded-xl bg-background px-3 py-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft font-mono text-xs font-semibold text-accent">
                  {initials}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">{user.name}</p>
                  <p className="num text-[10px] text-subtle">{user.regno}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-foreground hover:bg-danger-soft hover:text-danger"
              >
                <span className="material-symbols-outlined !text-[20px]">logout</span>
                Sign out
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="min-w-0 flex-1">
        <h1 className="truncate font-heading text-base font-bold text-primary">Overview</h1>
        {showRole ? (
          <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">
            {ROLE_LABEL[user.role]}
          </p>
        ) : null}
      </div>

      {/* Search — decorative until global search ships */}
      <div className="hidden h-9 w-64 items-center gap-2 rounded-xl border border-border bg-background px-3 md:flex">
        <span className="material-symbols-outlined !text-[18px] text-subtle">search</span>
        <span className="text-xs text-subtle">Search</span>
        <span className="ml-auto rounded-md border border-border px-1.5 py-0.5 font-mono text-[9px] text-subtle">
          /
        </span>
      </div>

      {/* Bell → the caller's announcement board. Plain <button> when there is
          no board to open, so we never render a dead link. */}
      {notificationsHref ? (
        <Link
          href={notificationsHref}
          aria-label={
            unreadCount > 0 ? `Announcements — ${unreadCount} unread` : 'Announcements'
          }
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-background hover:text-foreground"
        >
          <span className="material-symbols-outlined">notifications</span>
          {unreadCount > 0 ? <UnreadBadge count={unreadCount} /> : null}
        </Link>
      ) : (
        <button
          type="button"
          aria-label={
            unreadCount > 0 ? `Announcements — ${unreadCount} unread` : 'Announcements'
          }
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-background hover:text-foreground"
        >
          <span className="material-symbols-outlined">notifications</span>
          {unreadCount > 0 ? <UnreadBadge count={unreadCount} /> : null}
        </button>
      )}

      <div className="h-6 w-px shrink-0 bg-border" />

      {/* Account menu */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2 hover:bg-background"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft font-mono text-xs font-semibold text-accent">
            {initials}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block max-w-[120px] truncate text-xs font-semibold text-foreground">
              {user.name}
            </span>
            <span className="num block text-[10px] text-subtle">{user.regno}</span>
          </span>
          <span className="material-symbols-outlined !text-[18px] text-subtle">expand_more</span>
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div
              role="menu"
              className="animate-fade absolute right-0 z-40 mt-2 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-lift"
            >
              <div className="px-3 py-2.5">
                <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
                <p className="truncate text-xs text-muted">{user.email}</p>
                <p className="num mt-1 text-[10px] uppercase tracking-wider text-subtle">
                  {user.regno}
                  {showRole ? <> · {ROLE_LABEL[user.role]}</> : null}
                </p>
              </div>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                disabled
                className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-subtle"
              >
                <span className="material-symbols-outlined !text-[18px]">person</span>
                Profile
                <span className="ml-auto font-mono text-[9px] uppercase">Soon</span>
              </button>
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-danger-soft hover:text-danger"
              >
                <span className="material-symbols-outlined !text-[18px]">logout</span>
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}

/** 99+ cap — the badge is a hint, the board is the source of truth. */
function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="num absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold leading-none text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}
