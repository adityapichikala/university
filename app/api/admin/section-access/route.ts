import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { setSectionAccess } from '@/lib/permissions'

/**
 * Section-level course access (Tier 3, resource scoping).
 *
 * The HTTP twin of the governance dashboard's `setSectionAccessAction` — same
 * core in lib/permissions.ts, so the toggle in the browser and this endpoint
 * cannot diverge.
 *
 *   GET   /api/admin/section-access?courseId=…
 *   PATCH /api/admin/section-access  { courseId, classId, enabled }
 */

const patchSchema = z.object({
  courseId: z.string().trim().min(1, 'courseId is required'),
  classId: z.string().trim().min(1, 'classId is required'),
  enabled: z.boolean(),
})

export async function GET(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const courseId = req.nextUrl.searchParams.get('courseId')

  const rows = await prisma.courseSectionAccess.findMany({
    where: {
      ...scopes.college(ctx),
      ...(courseId ? { courseId } : {}),
    },
    select: {
      id: true,
      enabled: true,
      course: { select: { id: true, code: true, name: true } },
      class: { select: { id: true, name: true, semester: true } },
    },
    orderBy: [{ course: { code: 'asc' } }, { class: { name: 'asc' } }],
  })

  return NextResponse.json({
    access: rows.map((r) => ({
      id: r.id,
      courseId: r.course.id,
      course: r.course.code,
      classId: r.class.id,
      class: r.class.name,
      semester: r.class.semester,
      enabled: r.enabled,
    })),
  })
}

export async function PATCH(req: NextRequest) {
  const result = await authorizePermission(req, PERMISSIONS.USER_MANAGE)
  if (!result.ok) return result.response
  const { ctx } = result

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 }
    )
  }

  const outcome = await setSectionAccess(ctx, parsed.data)
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 400 })
  }

  return NextResponse.json({ access: outcome.data })
}
