'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { audit } from '@/lib/audit'
import type { MutationResult } from '@/lib/permissions'

/**
 * Department mutations (doc §7 — admin structure).
 *
 * Guarded by `department.manage`. Note this is *not* `department.view`: an HOD
 * can see their department but must not be able to rename it or appoint
 * themselves head of another one.
 *
 * The guard is called outside the try/catch on purpose — requirePermission()
 * redirects by throwing, and catching it would silently disable the check.
 */

const NAME_MIN = 2
const NAME_MAX = 80

/** Roles eligible to head a department. */
const HOD_ROLES = ['TEACHER', 'HOD'] as const

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/** True when `name` already exists in this college, ignoring case. */
async function nameTaken(
  collegeId: string,
  name: string,
  excludeId?: string
): Promise<boolean> {
  const siblings = await prisma.department.findMany({
    where: { collegeId },
    select: { id: true, name: true },
  })
  const target = name.toLowerCase()
  return siblings.some((d) => d.id !== excludeId && d.name.toLowerCase() === target)
}

export async function createDepartment(input: {
  name: string
}): Promise<MutationResult<{ id: string; name: string }>> {
  const ctx = await requirePermission(PERMISSIONS.DEPARTMENT_MANAGE, { route: 'admin' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  const name = cleanName(input?.name ?? '')
  if (name.length < NAME_MIN) return { ok: false, error: 'Name is too short' }
  if (name.length > NAME_MAX) return { ok: false, error: `Name must be ${NAME_MAX} characters or fewer` }
  if (await nameTaken(collegeId, name)) return { ok: false, error: 'A department with that name already exists' }

  try {
    const department = await prisma.department.create({
      data: { collegeId, name },
      select: { id: true, name: true },
    })

    await audit({
      ctx,
      agentName: 'admin',
      actionType: 'DEPARTMENT_CREATE',
      targetEntity: 'Department',
      entityId: department.id,
      before: null,
      after: { name: department.name },
    })

    revalidatePath('/dashboard/admin/departments')
    return { ok: true, data: department }
  } catch (error) {
    console.error('[departments] create failed', error)
    return { ok: false, error: 'Could not create that department' }
  }
}

export async function renameDepartment(input: {
  id: string
  name: string
}): Promise<MutationResult<{ id: string; name: string }>> {
  const ctx = await requirePermission(PERMISSIONS.DEPARTMENT_MANAGE, { route: 'admin' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  const name = cleanName(input?.name ?? '')
  if (name.length < NAME_MIN) return { ok: false, error: 'Name is too short' }
  if (name.length > NAME_MAX) return { ok: false, error: `Name must be ${NAME_MAX} characters or fewer` }

  try {
    const existing = await prisma.department.findFirst({
      where: { id: input.id, collegeId },
      select: { id: true, name: true },
    })
    if (!existing) return { ok: false, error: 'Department not found' }
    if (existing.name === name) return { ok: true, data: existing }
    if (await nameTaken(collegeId, name, existing.id)) {
      return { ok: false, error: 'A department with that name already exists' }
    }

    const updated = await prisma.department.update({
      where: { id: existing.id },
      data: { name },
      select: { id: true, name: true },
    })

    await audit({
      ctx,
      agentName: 'admin',
      actionType: 'DEPARTMENT_RENAME',
      targetEntity: 'Department',
      entityId: updated.id,
      before: { name: existing.name },
      after: { name: updated.name },
    })

    revalidatePath('/dashboard/admin/departments')
    return { ok: true, data: updated }
  } catch (error) {
    console.error('[departments] rename failed', error)
    return { ok: false, error: 'Could not rename that department' }
  }
}

/**
 * Appoint or clear a HOD.
 *
 * `hodUserId` is `@unique` on Department, so one person can head at most one
 * department — we refuse rather than silently stealing them from another.
 */
export async function assignHod(input: {
  id: string
  hodUserId: string | null
}): Promise<MutationResult<{ id: string; hodUserId: string | null }>> {
  const ctx = await requirePermission(PERMISSIONS.DEPARTMENT_MANAGE, { route: 'admin' })
  const collegeId = ctx.user.collegeId
  if (!collegeId) return { ok: false, error: 'No college scope' }

  try {
    const department = await prisma.department.findFirst({
      where: { id: input.id, collegeId },
      select: { id: true, name: true, hodUserId: true },
    })
    if (!department) return { ok: false, error: 'Department not found' }

    const hodUserId = input.hodUserId || null

    if (hodUserId) {
      const person = await prisma.user.findFirst({
        where: { id: hodUserId, collegeId, role: { in: [...HOD_ROLES] } },
        select: { id: true, name: true, regno: true, role: true },
      })
      if (!person) {
        return { ok: false, error: 'Only teaching staff can head a department' }
      }

      const elsewhere = await prisma.department.findFirst({
        where: { hodUserId, NOT: { id: department.id } },
        select: { id: true, name: true },
      })
      if (elsewhere) {
        return { ok: false, error: `${person.name} already heads ${elsewhere.name}` }
      }
    }

    const updated = await prisma.department.update({
      where: { id: department.id },
      data: { hodUserId },
      select: { id: true, hodUserId: true },
    })

    await audit({
      ctx,
      agentName: 'admin',
      actionType: hodUserId ? 'DEPARTMENT_HOD_ASSIGN' : 'DEPARTMENT_HOD_CLEAR',
      targetEntity: 'Department',
      entityId: department.id,
      before: { hodUserId: department.hodUserId },
      after: { hodUserId: updated.hodUserId, department: department.name },
    })

    revalidatePath('/dashboard/admin/departments')
    return { ok: true, data: updated }
  } catch (error) {
    console.error('[departments] assign HOD failed', error)
    return { ok: false, error: 'Could not update the HOD' }
  }
}
