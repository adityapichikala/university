/**
 * Certificate vocabulary — kept out of `lib/registrar-actions.ts` on purpose.
 *
 * A `'use server'` module may only export async functions; exporting a const
 * array, a type alias or a type guard from one is a hard build error
 * ("Server Actions must be async functions"). Anything the UI needs to *read*
 * lives here instead.
 */

export const CERTIFICATE_TYPES = [
  'BONAFIDE',
  'TRANSCRIPT',
  'PROVISIONAL',
  'DEGREE',
  'TRANSFER',
] as const

export type CertificateType = (typeof CERTIFICATE_TYPES)[number]

export function isCertificateType(value: unknown): value is CertificateType {
  return typeof value === 'string' && (CERTIFICATE_TYPES as readonly string[]).includes(value)
}

export const CERTIFICATE_TYPE_LABEL: Record<CertificateType, string> = {
  BONAFIDE: 'Bonafide',
  TRANSCRIPT: 'Transcript',
  PROVISIONAL: 'Provisional',
  DEGREE: 'Degree',
  TRANSFER: 'Transfer',
}
