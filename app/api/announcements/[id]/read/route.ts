import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, scopes, type AuthContext } from '@/lib/rbac'
import { readReceipts, resolveAudience } from '@/lib/announcements'

/**
 * PATCH /api/announcements/:id/read — mark an announcement read or unread.
 *
 * Read state is per user (`NotificationRead`), which is what makes
 * "read by 12 of 40" possible at all. Only members of the audience may
 * record a read: otherwise the denominator would be polluted by people who
 * were never addressed.
 */

type Ctx = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  /** false clears the read receipt. */
  read: z.boolean().default(true),
})

async function loadForCaller(id: string, ctx: AuthContext) {
  return prisma.notification.findFirst({
    where: { id, ...scopes.college(ctx) },
    select: {
      id: true,
      targetRole: true,
      targetDepartmentId: true,
      targetClassId: true,
      targets: { select: { userId: true } },
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const announcement = await loadForCaller(id, ctx)
  if (!announcement) {
    return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
  }

  // Audience check: staff see everything, students only what is addressed to
  // them. Mirrors GET /api/announcements exactly.
  const staff = ['ADMIN', 'TEACHER', 'HOD'].includes(ctx.user.role)
  if (!staff) {
    const enrollments = await prisma.courseEnrollment.findMany({
      where: { studentId: ctx.user.id },
      select: { classId: true },
    })
    const classIds = Array.from(new Set(enrollments.map((e) => e.classId).filter(Boolean) as string[]))
    const named = announcement.targets.some((t) => t.userId === ctx.user.id)

    const inAudience =
      named ||
      ((!announcement.targetRole || announcement.targetRole === ctx.user.role) &&
        (!announcement.targetDepartmentId ||
          announcement.targetDepartmentId === ctx.user.departmentId) &&
        (!announcement.targetClassId || classIds.includes(announcement.targetClassId)))

    if (!inAudience) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
    }
  }

  if (parsed.data.read) {
    await prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId: id, userId: ctx.user.id } },
      update: {},
      create: { notificationId: id, userId: ctx.user.id },
    })
  } else {
    await prisma.notificationRead
      .delete({ where: { notificationId_userId: { notificationId: id, userId: ctx.user.id } } })
      .catch(() => undefined)
  }

  // Recompute the receipt so the caller sees the new "12 of 40" immediately.
  const audienceIds = await resolveAudience(prisma, {
    collegeId: ctx.user.collegeId ?? '',
    targetRole: announcement.targetRole,
    targetDepartmentId: announcement.targetDepartmentId,
    targetClassId: announcement.targetClassId,
    targetUserIds: announcement.targets.map((t) => t.userId),
  })
  const receipts = await readReceipts(prisma, { notificationId: id, audienceIds })

  return NextResponse.json({
    read: parsed.data.read,
    audience: {
      size: receipts.audience,
      read: receipts.read,
      unread: receipts.unread,
      percent: receipts.percent,
    },
  })
}
