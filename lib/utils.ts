import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Registration numbers, IDs, marks, money — always mono + tabular. */
export function formatRegno(value: string) {
  return value.toUpperCase()
}
