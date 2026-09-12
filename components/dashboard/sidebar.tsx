'use client'

import { ROLE_LABEL, type Role } from '@/lib/roles'
import { NavList } from './nav-list'
import type { NavSection } from './nav-items'

interface SidebarProps {
  sections: NavSection[]
  role: Role
  /** Shown in the footer badge for students, in place of the role name. */
  regno: string
  collegeName?: string | null
}

export function Sidebar({ sections, role, regno, collegeName }: SidebarProps) {
  /**
   * The footer badge is an identity anchor, and identity differs by role.
   *
   * A student is identified by their registration number — the role row the
   * database resolved for them is an implementation detail, so the badge shows
   * "STU001" rather than "Student". Staff keep the role: an HOD who also
   * teaches needs to know which hat is on.
   */
  const isStudent = role === 'STUDENT'
  const badgeLabel = isStudent ? 'Reg no.' : 'Role'
  const badgeValue = isStudent ? regno : ROLE_LABEL[role]

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-border bg-surface lg:flex">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-border px-5">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary">
          <span className="material-symbols-outlined !text-[20px] text-white">school</span>
        </div>
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-bold leading-tight text-primary">
            {collegeName ?? 'Apex University'}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">Campus ERP</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="scrollbar-slim flex-1 overflow-y-auto px-3 py-5">
        <NavList sections={sections} />
      </nav>

      {/* Identity badge */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-xl bg-background px-3 py-2.5">
          <span className="material-symbols-outlined !text-[18px] text-accent">
            {isStudent ? 'badge' : 'verified_user'}
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">
              {badgeLabel}
            </p>
            <p className="num truncate text-xs font-semibold text-foreground">{badgeValue}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
