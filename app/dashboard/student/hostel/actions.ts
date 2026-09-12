'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireUser, requirePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { audit } from '@/lib/audit'
import type { MutationResult } from '@/lib/permissions'
import { MAX_LEAVE_NIGHTS, parseDateOnly } from '@/lib/hostel-leave'
import {
  leaveSlipQrDataUrl,
  buildLeaveSlipPdf,
  type LeaveSlipFacts,
} from '@/lib/leave-slip'

/**
 * Hostel leave, student side.
 *
 * No special permission — the write is scoped to `studentId === caller`, which
 * is the real guard: a student can only ever file their own leave.
 *
 * The warden decides in `app/dashboard/warden/hostel-actions.ts`.
 */

export interface HostelLeaveRow {
  id: string
  fromDate: string
  toDate: string
  reason: string
  status: string
  nights: number
  note: string | null
  /** ISO date the warden decided, or null while still pending. */
  decidedAt?: string | null
  /** Name of the warden who decided — the slip names its approver. */
  decidedByName?: string | null
}

export async function requestHostelLeave(input: {
  fromDate: string
  toDate: string
  reason: string
}): Promise<MutationResult<HostelLeaveRow>> {
  const ctx = await requireUser({ route: 'student' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  const from = parseDateOnly(input.fromDate ?? '')
  const to = parseDateOnly(input.toDate ?? '')
  const reason = (input.reason ?? '').trim()

  if (!from) return { ok: false, error: 'Choose a start date' }
  if (!to) return { ok: false, error: 'Choose an end date' }
  if (to.getTime() < from.getTime()) {
    return { ok: false, error: 'The return date must be after the departure date' }
  }
  if (reason.length < 10) {
    return { ok: false, error: 'Tell the warden why — at least 10 characters' }
  }
  if (reason.length > 500) return { ok: false, error: 'That reason is too long (500 max)' }

  const nights = Math.round((to.getTime() - from.getTime()) / 86_400_000)
  if (nights < 1) return { ok: false, error: 'A hostel leave must cover at least one night' }
  if (nights > MAX_LEAVE_NIGHTS) {
    return { ok: false, error: `${MAX_LEAVE_NIGHTS} nights is the maximum in one request` }
  }

  try {
    // Overlapping request? Refuse rather than creating a duplicate booking.
    const clash = await prisma.hostelLeave.findFirst({
      where: {
        collegeId,
        studentId: ctx.user.id,
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: to },
        toDate: { gte: from },
      },
      select: { id: true, status: true, fromDate: true, toDate: true },
    })
    if (clash) {
      return {
        ok: false,
        error: `You already have a ${clash.status.toLowerCase()} leave covering these dates`,
      }
    }

    const row = await prisma.hostelLeave.create({
      data: {
        collegeId,
        studentId: ctx.user.id,
        fromDate: from,
        toDate: to,
        reason,
        status: 'PENDING',
      },
      select: {
        id: true,
        fromDate: true,
        toDate: true,
        reason: true,
        status: true,
      },
    })

    await audit({
      ctx,
      agentName: 'hostel',
      actionType: 'HOSTEL_LEAVE_REQUEST',
      targetEntity: 'HostelLeave',
      entityId: row.id,
      after: { nights, from: row.fromDate.toISOString().slice(0, 10) },
    })

    revalidatePath('/dashboard/student/hostel')
    revalidatePath('/dashboard/warden')
    return {
      ok: true,
      data: {
        id: row.id,
        fromDate: row.fromDate.toISOString().slice(0, 10),
        toDate: row.toDate.toISOString().slice(0, 10),
        reason: row.reason,
        status: row.status,
        nights,
        note: null,
      },
    }
  } catch (error) {
    console.error('[hostel-leave] request failed', error)
    return { ok: false, error: 'Could not submit that request' }
  }
}

/** Cancel your own request while it is still pending. */
export async function cancelHostelLeave(
  input: { id: string }
): Promise<MutationResult<{ id: string }>> {
  const ctx = await requireUser({ route: 'student' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  try {
    const row = await prisma.hostelLeave.findFirst({
      where: { id: input.id, collegeId, studentId: ctx.user.id },
      select: { id: true, status: true },
    })
    if (!row) return { ok: false, error: 'Request not found' }
    if (row.status !== 'PENDING') {
      return { ok: false, error: `Already ${row.status.toLowerCase()} — contact the warden` }
    }

    await prisma.hostelLeave.update({
      where: { id: row.id },
      data: { status: 'CANCELLED' },
    })

    await audit({
      ctx,
      agentName: 'hostel',
      actionType: 'HOSTEL_LEAVE_CANCEL',
      targetEntity: 'HostelLeave',
      entityId: row.id,
    })

    revalidatePath('/dashboard/student/hostel')
    revalidatePath('/dashboard/warden')
    return { ok: true, data: { id: row.id } }
  } catch (error) {
    console.error('[hostel-leave] cancel failed', error)
    return { ok: false, error: 'Could not cancel that request' }
  }
}

/** Warden: approve or reject. Guarded by `hostel.manage`. */
export async function decideHostelLeave(input: {
  id: string
  decision: 'APPROVED' | 'REJECTED'
  note?: string
}): Promise<MutationResult<{ id: string; status: string }>> {
  const ctx = await requirePermission(PERMISSIONS.HOSTEL_MANAGE, { route: 'warden' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') {
    return { ok: false, error: 'Unknown decision' }
  }

  try {
    const row = await prisma.hostelLeave.findFirst({
      where: { id: input.id, ...scopes.college(ctx) },
      select: { id: true, status: true, student: { select: { regno: true } } },
    })
    if (!row) return { ok: false, error: 'Request not found' }
    if (row.status !== 'PENDING') {
      return { ok: false, error: `Already ${row.status.toLowerCase()}` }
    }

    await prisma.hostelLeave.update({
      where: { id: row.id },
      data: {
        status: input.decision,
        decidedByUserId: ctx.user.id,
        decidedAt: new Date(),
        decisionNote: input.note?.trim() || null,
      },
    })

    await audit({
      ctx,
      agentName: 'hostel',
      actionType: `HOSTEL_LEAVE_${input.decision}`,
      targetEntity: 'HostelLeave',
      entityId: row.id,
      after: { regno: row.student.regno, note: input.note?.trim() || null },
    })

    revalidatePath('/dashboard/warden')
    revalidatePath('/dashboard/student/hostel')
    return { ok: true, data: { id: row.id, status: input.decision } }
  } catch (error) {
    console.error('[hostel-leave] decision failed', error)
    return { ok: false, error: 'Could not record that decision' }
  }
}

/**
 * Generate a QR data-url for the leave slip.
 * The caller must own the leave row.
 */
export async function generateLeaveSlipQr(
  input: { id: string }
): Promise<MutationResult<{ dataUrl: string }>> {
  const ctx = await requireUser({ route: 'student' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  try {
    const row = await prisma.hostelLeave.findFirst({
      where: { id: input.id, collegeId, studentId: ctx.user.id },
      include: {
        decidedBy: { select: { name: true } },
        student: {
          select: {
            name: true,
            regno: true,
            hostelAllocations: {
              where: { vacatedAt: null },
              select: {
                room: { select: { block: true, roomNumber: true } },
              },
              take: 1,
            },
          },
        },
      },
    })
    if (!row) return { ok: false, error: 'Leave request not found' }

    const liveAlloc = row.student.hostelAllocations[0] ?? null
    const facts: LeaveSlipFacts = {
      id: row.id,
      studentName: row.student.name,
      regno: row.student.regno,
      roomLabel: liveAlloc
        ? `${liveAlloc.room.block}-${liveAlloc.room.roomNumber}`
        : null,
      block: liveAlloc ? String(liveAlloc.room.block) : null,
      fromDate: row.fromDate.toISOString().slice(0, 10),
      toDate: row.toDate.toISOString().slice(0, 10),
      nights: Math.max(1, Math.round((row.toDate.getTime() - row.fromDate.getTime()) / 86_400_000)),
      reason: row.reason,
      status: row.status,
      decidedByName: row.decidedBy?.name ?? null,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString().slice(0, 10) : null,
      note: row.decisionNote,
    }

    const dataUrl = await leaveSlipQrDataUrl(facts)
    return { ok: true, data: { dataUrl } }
  } catch (error) {
    console.error('[hostel-leave] qr generation failed', error)
    return { ok: false, error: 'Could not generate QR code' }
  }
}

/**
 * Build and return the leave slip PDF as a base64 string.
 * The caller must own the leave row.
 */
export async function downloadLeaveSlipPdf(
  input: { id: string }
): Promise<MutationResult<{ base64: string; filename: string }>> {
  const ctx = await requireUser({ route: 'student' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  try {
    const row = await prisma.hostelLeave.findFirst({
      where: { id: input.id, collegeId, studentId: ctx.user.id },
      include: {
        decidedBy: { select: { name: true } },
        student: {
          select: {
            name: true,
            regno: true,
            hostelAllocations: {
              where: { vacatedAt: null },
              select: {
                room: { select: { block: true, roomNumber: true } },
              },
              take: 1,
            },
          },
        },
      },
    })
    if (!row) return { ok: false, error: 'Leave request not found' }

    const liveAlloc = row.student.hostelAllocations[0] ?? null
    const facts: LeaveSlipFacts = {
      id: row.id,
      studentName: row.student.name,
      regno: row.student.regno,
      roomLabel: liveAlloc
        ? `${liveAlloc.room.block}-${liveAlloc.room.roomNumber}`
        : null,
      block: liveAlloc ? String(liveAlloc.room.block) : null,
      fromDate: row.fromDate.toISOString().slice(0, 10),
      toDate: row.toDate.toISOString().slice(0, 10),
      nights: Math.max(1, Math.round((row.toDate.getTime() - row.fromDate.getTime()) / 86_400_000)),
      reason: row.reason,
      status: row.status,
      decidedByName: row.decidedBy?.name ?? null,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString().slice(0, 10) : null,
      note: row.decisionNote,
    }

    const pdf = buildLeaveSlipPdf(facts)
    const base64 = pdf.toString('base64')
    const ref = `LS-${row.id.slice(-8).toUpperCase()}`
    return {
      ok: true,
      data: {
        base64,
        filename: `Apex-Hostel-Leave-${ref}.pdf`,
      },
    }
  } catch (error) {
    console.error('[hostel-leave] pdf generation failed', error)
    return { ok: false, error: 'Could not generate PDF' }
  }
}
