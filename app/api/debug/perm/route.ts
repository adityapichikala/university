import { NextResponse, type NextRequest } from 'next/server'
import { getSessionFromRequest, loadPermissions } from '@/lib/rbac'
import { prisma } from '@/lib/db'
import { PERMISSIONS } from '@/lib/roles'

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'no session' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true, collegeId: true },
  })
  if (!user) return NextResponse.json({ error: 'no user' }, { status: 401 })
  const perms = await loadPermissions(user.role, session.userId)
  return NextResponse.json({
    role: user.role,
    hasClearanceManage: perms.has(PERMISSIONS.CLEARANCE_MANAGE),
    totalPerms: perms.size,
    example: Array.from(perms).slice(0, 8),
  })
}
