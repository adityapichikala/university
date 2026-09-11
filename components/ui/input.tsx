import * as React from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-sm text-foreground',
        'placeholder:text-subtle',
        'transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
      {...props}
    />
  )
}
