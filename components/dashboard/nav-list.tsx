'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { NavSection } from './nav-items'

interface NavListProps {
  sections: NavSection[]
  /** Lets the mobile sheet close itself after a tap. */
  onNavigate?: () => void
}

export function NavList({ sections, onNavigate }: NavListProps) {
  const pathname = usePathname()

  return (
    <>
      {sections.map((section) => (
        <div key={section.title} className="mb-6 last:mb-0">
          <p className="mb-2 px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = item.href
                ? pathname === item.href || pathname.startsWith(`${item.href}/`)
                : false

              const inner = (
                <>
                  <span
                    className={cn(
                      'material-symbols-outlined !text-[20px] shrink-0',
                      active ? 'text-accent' : 'text-subtle'
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                  {!item.href && (
                    <span className="ml-auto rounded-md bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-subtle">
                      Soon
                    </span>
                  )}
                </>
              )

              const base = 'flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors'

              if (!item.href) {
                return (
                  <li key={item.label}>
                    <span className={cn(base, 'cursor-not-allowed text-subtle opacity-70')} aria-disabled>
                      {inner}
                    </span>
                  </li>
                )
              }

              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      base,
                      active
                        ? 'bg-accent-soft font-semibold text-accent'
                        : 'text-muted hover:bg-background hover:text-foreground'
                    )}
                  >
                    {inner}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </>
  )
}
