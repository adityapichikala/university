import * as React from 'react'
import { cn } from '@/lib/utils'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        'mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-wider text-muted',
        className
      )}
      {...props}
    />
  )
}
