import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorize, authorizePermission, scopes, type AuthContext } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { ROLES } from '@/lib/roles'
import {
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_SELECT,
  MAX_BODY,
  MAX_TITLE,
  broadcastAnnouncements,
  fetchAnnouncementFeed,
  readReceipts,
  resolveAudience,
} from '@/lib/announcements'

/**
 * GET  /api/announcements — everything addressed to the caller.
 * POST /api/announcements — broadcast one (admin + teacher only).
 *
 * Read is open to any authenticated member of a college: the audience is
 * computed per request, so a student simply never sees rows not meant for
 * them. Write is Tier 1 — ADMIN or TEACHER — because announcements go out
 * under the college's name.
 */

/**
 * `expiresAt` must be a real date and must be in the future at post time —
 * a notice that expired before it was sent is always a mistake, and silently
 * accepting it would produce a broadcast that nobody can ever see.
 */
const expiresAtSchema = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional()
  .refine(
    (value) => !value || !Number.isNaN(new Date(value).getTime()),
    'expiresAt must be a valid ISO date'
  )
  .refine(
    (value) => !value || new Date(value).getTime() > Date.now(),
    'expiresAt must be in the future'
  )

const createSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(MAX_TITLE),
  body: z.string().trim().min(1, 'body is required').max(MAX_BODY),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).default('NORMAL'),
  expiresAt: expiresAtSchema,
  /** null / omitted = all roles. */
  targetRole: z.enum(ROLES).nullable().optional(),
  targetDepartmentId: z.string().trim().min(1).nullable().optional(),
  targetClassId: z.string().trim().min(1).nullable().optional(),
  targetUserIds: z.array(z.string().trim().min(1)).max(500).optional(),
})

/** The caller's own profile, shaped for audience resolution. */
async function callerProfile(ctx: AuthContext) {
  const enrollments = await prisma.courseEnrollment.findMany({
    where: { studentId: ctx.user.id },
    select: { classId: true },
  })
  return {
    id: ctx.user.id,
    role: ctx.user.role,
    departmentId: ctx.user.departmentId,
    classIds: Array.from(new Set(enrollments.map((e) => e.classId).filter(Boolean) as string[])),
  }
}

export async function GET(req: NextRequest) {
  const result = await authorize(req)
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  const profile = await callerProfile(ctx)
  // Staff may ask for lapsed notices back (to audit what went out); everyone
  // else gets the live board only.
  const includeExpired = req.nextUrl.searchParams.get('includeExpired') === '1' && isStaff(ctx)

  const announcements = await fetchAnnouncementFeed(prisma, {
    collegeId: ctx.user.collegeId,
    user: profile,
    includeExpired,
    take: 50,
  })

  return NextResponse.json({ announcements })
}

/** Who may page back through the college's full broadcast history. */
function isStaff(ctx: AuthContext): boolean {
  return ctx.user.role === 'ADMIN' || ctx.user.role === 'HOD' || ctx.user.role === 'TEACHER'
}

export async function POST(req: NextRequest) {
  const result = await authorizePermission(req, 'announcement.broadcast')
  if (!result.ok) return result.response
  const { ctx } = result
  if (!ctx.user.collegeId) {
    return NextResponse.json({ error: 'No college scope' }, { status: 403 })
  }

  // Tier 1: only staff may post under the college's name.
  if (ctx.user.role !== 'ADMIN' && ctx.user.role !== 'TEACHER' && ctx.user.role !== 'HOD') {
    await audit({
      ctx,
      agentName: 'announcements',
      actionType: 'ANNOUNCEMENT_CREATE',
      targetEntity: 'Notification',
      status: 'REJECTED',
      after: { reason: 'role may not broadcast', role: ctx.user.role },
    })
    return NextResponse.json(
      { error: 'Only admin and teaching staff may post announcements' },
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  // A teacher may only broadcast inside their own department. Silently
  // rewriting someone else's department would let a caller believe they
  // reached an audience they were never allowed to address, so an explicit
  // attempt is refused rather than coerced. Omitting it defaults to their own.
  let targetDepartmentId = parsed.data.targetDepartmentId ?? null
  const targetClassId = parsed.data.targetClassId ?? null
  if (ctx.user.role === 'TEACHER') {
    if (targetDepartmentId && targetDepartmentId !== ctx.user.departmentId) {
      await audit({
        ctx,
        agentName: 'announcements',
        actionType: 'ANNOUNCEMENT_CREATE',
        targetEntity: 'Notification',
        status: 'REJECTED',
        after: { reason: 'teacher may not target another department', targetDepartmentId },
      })
      return NextResponse.json(
        { error: 'Teachers may only broadcast to their own department' },
        { status: 403 }
      )
    }
    targetDepartmentId = ctx.user.departmentId
  }

  if (targetDepartmentId) {
    const dept = await prisma.department.findFirst({
      where: { id: targetDepartmentId, ...scopes.college(ctx) },
      select: { id: true },
    })
    if (!dept) {
      await audit({
        ctx,
        agentName: 'announcements',
        actionType: 'ANNOUNCEMENT_CREATE',
        targetEntity: 'Notification',
        status: 'REJECTED',
        after: { reason: 'department not in college', targetDepartmentId },
      })
      return NextResponse.json({ error: 'Department not found in your college' }, { status: 404 })
    }
  }

  if (targetClassId) {
    const klass = await prisma.class.findFirst({
      where: { id: targetClassId, ...scopes.college(ctx) },
      select: { id: true },
    })
    if (!klass) {
      await audit({
        ctx,
        agentName: 'announcements',
        actionType: 'ANNOUNCEMENT_CREATE',
        targetEntity: 'Notification',
        status: 'REJECTED',
        after: { reason: 'class not in college', targetClassId },
      })
      return NextResponse.json({ error: 'Class not found in your college' }, { status: 404 })
    }
  }

  const broadcast = await broadcastAnnouncements(prisma, {
    collegeId: ctx.user.collegeId,
    createdByUserId: ctx.user.id,
    title: parsed.data.title,
    body: parsed.data.body,
    priority: parsed.data.priority,
    expiresAt: parsed.data.expiresAt ?? null,
    targetRole: parsed.data.targetRole ?? null,
    targetDepartmentId,
    targetClassId,
    targetUserIds: parsed.data.targetUserIds,
  })

  const notification = await prisma.notification.findUnique({
    where: { id: broadcast.notificationId },
    select: ANNOUNCEMENT_SELECT,
  })

  const audienceIds = await resolveAudience(prisma, {
    collegeId: ctx.user.collegeId,
    targetRole: parsed.data.targetRole ?? null,
    targetDepartmentId,
    targetClassId,
    targetUserIds: notification?.targets.map((t) => t.userId) ?? [],
  })

  const receipts = await readReceipts(prisma, {
    notificationId: broadcast.notificationId,
    audienceIds,
  })

  await audit({
    ctx,
    agentName: 'announcements',
    actionType: 'ANNOUNCEMENT_CREATE',
    targetEntity: 'Notification',
    entityId: broadcast.notificationId,
    after: {
      title: parsed.data.title,
      priority: parsed.data.priority,
      expiresAt: parsed.data.expiresAt ?? null,
      targetRole: parsed.data.targetRole ?? null,
      targetDepartmentId,
      targetClassId,
      explicitTargets: broadcast.explicitTargets,
      audienceSize: receipts.audience,
    },
  })

  return NextResponse.json(
    {
      announcement: notification,
      audience: {
        size: receipts.audience,
        read: receipts.read,
        unread: receipts.unread,
        percent: receipts.percent,
      },
    },
    { status: 201 }
  )
}
