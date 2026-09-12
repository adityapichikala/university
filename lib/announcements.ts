import type { PrismaClient } from '@prisma/client'

/**
 * Announcements — broadcast notices with read receipts (doc §7 Phase 4).
 *
 * Built on the existing `Notification` / `NotificationRead` models rather than
 * a parallel pair, so the app has exactly one inbox. `NotificationTarget` is
 * the only addition: it lets an author name individuals, which the
 * role/department/class predicate columns cannot express.
 *
 * ── Why audience resolution is a predicate, not a copy ────────────────────
 * An announcement targeted at "STUDENT" reaches whoever is a student *now*,
 * including people who enrolled after it was posted. Materialising one row per
 * recipient would freeze the audience at post time and silently miss them.
 * So: store the predicate, resolve the audience on read.
 *
 * The cost is that "read by 12 of 40" needs the audience recomputed to answer
 * — which `readReceipts()` does in two grouped counts, not N queries.
 */

/**
 * SQLite has no native enum, so — as with `User.role` — the literal union and
 * its guard live here, and `lib/roles.ts`-style constants are the source of
 * truth. Anything read from the DB is treated as untrusted and falls back to
 * NORMAL, so a bad row can never crash a screen.
 */
export const ANNOUNCEMENT_PRIORITIES = ['LOW', 'NORMAL', 'URGENT'] as const
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number]

export function isAnnouncementPriority(value: unknown): value is AnnouncementPriority {
  return typeof value === 'string' && (ANNOUNCEMENT_PRIORITIES as readonly string[]).includes(value)
}

export function asAnnouncementPriority(value: unknown): AnnouncementPriority {
  return isAnnouncementPriority(value) ? value : 'NORMAL'
}

/** Display order: URGENT first, then NORMAL, then LOW. */
const PRIORITY_RANK: Record<AnnouncementPriority, number> = {
  URGENT: 0,
  NORMAL: 1,
  LOW: 2,
}

export function priorityRank(value: unknown): number {
  return PRIORITY_RANK[asAnnouncementPriority(value)]
}

/**
 * Is this notice still on the board?
 *
 * Expiry is evaluated against `now` on every read rather than by a sweeper job,
 * which means an announcement that lapses mid-session disappears on the next
 * fetch with no stale window to reason about.
 */
export function isLive(
  announcement: { expiresAt?: string | Date | null },
  now: Date = new Date()
): boolean {
  if (!announcement.expiresAt) return true
  const expiresAt =
    announcement.expiresAt instanceof Date
      ? announcement.expiresAt
      : new Date(announcement.expiresAt)
  if (Number.isNaN(expiresAt.getTime())) return true
  return expiresAt.getTime() > now.getTime()
}

export interface BroadcastInput {
  collegeId: string
  createdByUserId: string
  title: string
  body: string
  priority?: AnnouncementPriority
  /** ISO datetime or null. Past dates are rejected by the API, not here. */
  expiresAt?: string | Date | null
  /** null = every role. */
  targetRole?: string | null
  targetDepartmentId?: string | null
  targetClassId?: string | null
  /** Individuals to reach regardless of the predicate above. */
  targetUserIds?: string[]
}

export interface BroadcastResult {
  notificationId: string
  /** Size of the audience at post time — informational, not the truth. */
  audienceSize: number
  /** How many of `targetUserIds` were actually in this college. */
  explicitTargets: number
}

export const MAX_TITLE = 160
export const MAX_BODY = 4000

/**
 * Post an announcement and return it with its initial audience size.
 *
 * `targetUserIds` are validated against the college: ids belonging to another
 * tenant are dropped rather than silently granting them sight of the notice.
 */
export async function broadcastAnnouncements(
  prisma: PrismaClient,
  input: BroadcastInput
): Promise<BroadcastResult> {
  const wanted = Array.from(new Set(input.targetUserIds ?? []))

  const valid = wanted.length
    ? await prisma.user.findMany({
        where: { id: { in: wanted }, collegeId: input.collegeId },
        select: { id: true },
      })
    : []

  const notification = await prisma.notification.create({
    data: {
      collegeId: input.collegeId,
      createdByUserId: input.createdByUserId,
      title: input.title,
      body: input.body,
      priority: asAnnouncementPriority(input.priority),
      expiresAt: toDate(input.expiresAt),
      targetRole: input.targetRole ?? null,
      targetDepartmentId: input.targetDepartmentId ?? null,
      targetClassId: input.targetClassId ?? null,
      ...(valid.length > 0 && {
        targets: { create: valid.map((u) => ({ userId: u.id })) },
      }),
    },
    select: { id: true },
  })

  const audience = await resolveAudience(prisma, {
    collegeId: input.collegeId,
    targetRole: input.targetRole ?? null,
    targetDepartmentId: input.targetDepartmentId ?? null,
    targetClassId: input.targetClassId ?? null,
    targetUserIds: valid.map((u) => u.id),
  })

  return {
    notificationId: notification.id,
    audienceSize: audience.length,
    explicitTargets: valid.length,
  }
}

export interface AudienceQuery {
  collegeId: string
  targetRole?: string | null
  targetDepartmentId?: string | null
  targetClassId?: string | null
  targetUserIds?: string[]
}

/**
 * Who does this announcement reach? Predicate match ∪ explicit targets.
 *
 * `targetClassId` resolves through the student's enrollments — a class
 * (section) is not a column on User, it is derived from what they are
 * enrolled in.
 */
export async function resolveAudience(
  prisma: PrismaClient,
  query: AudienceQuery
): Promise<string[]> {
  const explicit = query.targetUserIds ?? []

  // No predicate + named people = exactly those people (see isInAudience).
  const hasPredicate = Boolean(
    query.targetRole || query.targetDepartmentId || query.targetClassId
  )
  if (!hasPredicate && explicit.length > 0) return Array.from(new Set(explicit))

  const matched = await prisma.user.findMany({
    where: {
      collegeId: query.collegeId,
      status: 'ACTIVE',
      ...(query.targetRole ? { role: query.targetRole } : {}),
      ...(query.targetDepartmentId ? { departmentId: query.targetDepartmentId } : {}),
      ...(query.targetClassId
        ? { enrollments: { some: { classId: query.targetClassId } } }
        : {}),
    },
    select: { id: true },
  })

  return Array.from(new Set([...matched.map((u) => u.id), ...explicit]))
}

/**
 * Does this specific user fall inside an announcement's audience?
 *
 * Naming individuals normally *adds* to the predicate — "teachers, plus these
 * three people". But when no predicate is set at all, "everyone" would swallow
 * the intent of naming anyone, and a teacher who picks one student would mail
 * the whole college. So: with no role/department/class filter, the named list
 * is the whole audience, not an addition to it.
 */
export function isInAudience(
  user: { id: string; role: string; departmentId: string | null; classIds: string[] },
  announcement: {
    targetRole: string | null
    targetDepartmentId: string | null
    targetClassId: string | null
    targetUserIds: string[]
  }
): boolean {
  if (announcement.targetUserIds.includes(user.id)) return true

  const hasPredicate = Boolean(
    announcement.targetRole || announcement.targetDepartmentId || announcement.targetClassId
  )
  if (!hasPredicate) return announcement.targetUserIds.length === 0

  if (announcement.targetRole && announcement.targetRole !== user.role) return false
  if (announcement.targetDepartmentId && announcement.targetDepartmentId !== user.departmentId) {
    return false
  }
  if (announcement.targetClassId && !user.classIds.includes(announcement.targetClassId)) {
    return false
  }
  return true
}

/** The caller, shaped for audience resolution. */
export interface FeedUser {
  id: string
  role: string
  departmentId: string | null
  /** Sections the caller is enrolled in — a class is not a column on User. */
  classIds: string[]
}

/**
 * ADMIN and HOD run the college, so they see the whole board — including
 * notices not addressed to them. Every other role sees only what reaches them
 * (plus anything they wrote themselves). This is deliberate: an overseer who
 * cannot see a broadcast cannot moderate it.
 */
const OVERSEER_ROLES = new Set(['ADMIN', 'HOD'])

/** One audience rule, shared by the REST feed, the layout and the banner. */
export function feedIncludes(
  user: FeedUser,
  n: {
    createdByUserId: string
    targetRole: string | null
    targetDepartmentId: string | null
    targetClassId: string | null
    targetUserIds: string[]
  }
): boolean {
  if (OVERSEER_ROLES.has(user.role)) return true
  if (n.createdByUserId === user.id) return true
  return isInAudience(user, n)
}

/** Columns every announcement surface needs — defined once, used everywhere. */
export const ANNOUNCEMENT_SELECT = {
  id: true,
  title: true,
  body: true,
  priority: true,
  expiresAt: true,
  targetRole: true,
  targetDepartmentId: true,
  targetClassId: true,
  createdByUserId: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, regno: true } },
  targetDepartment: { select: { id: true, name: true } },
  targetClass: { select: { id: true, name: true } },
  targets: { select: { userId: true } },
  reads: { select: { userId: true, readAt: true } },
} as const

export interface FeedItem {
  id: string
  title: string
  body: string
  priority: AnnouncementPriority
  expiresAt: Date | null
  createdAt: Date
  createdBy: { id: string; name: string; regno: string }
  audience: string
  readAt: Date | null
  readCount: number
  explicitCount: number
  authoredByMe: boolean
  /** True when the caller was named individually, not just caught by a filter. */
  named: boolean
}

/**
 * The caller's board: live, addressed to them, newest first.
 *
 * Expiry is filtered twice — once in SQL (`expiresAt > now`) and once in
 * memory — because the SQL bound is evaluated when the query runs, and a
 * long-lived client may hold the result past the boundary. Null `expiresAt`
 * means "never expires" and is always kept.
 */
export async function fetchAnnouncementFeed(
  prisma: PrismaClient,
  params: { collegeId: string; user: FeedUser; includeExpired?: boolean; take?: number }
): Promise<FeedItem[]> {
  const now = new Date()
  const take = params.take ?? 50

  const rows = await prisma.notification.findMany({
    where: {
      collegeId: params.collegeId,
      ...(params.includeExpired
        ? {}
        : { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }),
    },
    select: ANNOUNCEMENT_SELECT,
    orderBy: { createdAt: 'desc' },
    take,
  })

  return rows
    .filter((n) => params.includeExpired || isLive(n, now))
    .filter((n) =>
      feedIncludes(params.user, {
        createdByUserId: n.createdByUserId,
        targetRole: n.targetRole,
        targetDepartmentId: n.targetDepartmentId,
        targetClassId: n.targetClassId,
        targetUserIds: n.targets.map((t) => t.userId),
      })
    )
    // Urgent first, then newest. Sorted here rather than in each consumer so
    // the API, the banner and the inbox can never disagree about ordering.
    .sort((a, b) => {
      const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
      if (byPriority !== 0) return byPriority
      return b.createdAt.getTime() - a.createdAt.getTime()
    })
    .map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      priority: asAnnouncementPriority(n.priority),
      expiresAt: n.expiresAt,
      createdAt: n.createdAt,
      createdBy: n.createdBy,
      audience: audienceLabel({
        targetRole: n.targetRole,
        targetDepartmentName: n.targetDepartment?.name ?? null,
        targetClassName: n.targetClass?.name ?? null,
        explicitCount: n.targets.length,
      }),
      readAt: n.reads.find((r) => r.userId === params.user.id)?.readAt ?? null,
      readCount: n.reads.length,
      explicitCount: n.targets.length,
      authoredByMe: n.createdByUserId === params.user.id,
      named: n.targets.some((t) => t.userId === params.user.id),
    }))
}

export interface ReadReceipts {
  audience: number
  read: number
  unread: number
  /** 0–100. Zero audience reads as 0%, never NaN. */
  percent: number
}

/**
 * "Read by 12 of 40" — two grouped counts against `NotificationRead`.
 * The denominator is the *resolved* audience, so it stays honest when people
 * join or leave the target group after posting.
 */
export async function readReceipts(
  prisma: PrismaClient,
  params: {
    notificationId: string
    audienceIds: string[]
  }
): Promise<ReadReceipts> {
  if (params.audienceIds.length === 0) {
    return { audience: 0, read: 0, unread: 0, percent: 0 }
  }

  const reads = await prisma.notificationRead.count({
    where: { notificationId: params.notificationId, userId: { in: params.audienceIds } },
  })

  const audience = params.audienceIds.length
  return {
    audience,
    read: reads,
    unread: audience - reads,
    percent: Math.round((reads / audience) * 100),
  }
}

/** Human sentence for the audience chips, e.g. "Role: Student · CSE-A". */
export function audienceLabel(parts: {
  targetRole?: string | null
  targetDepartmentName?: string | null
  targetClassName?: string | null
  explicitCount?: number
}): string {
  const bits: string[] = []
  if (parts.targetRole) bits.push(`Role: ${titleCase(parts.targetRole)}`)
  if (parts.targetDepartmentName) bits.push(parts.targetDepartmentName)
  if (parts.targetClassName) bits.push(parts.targetClassName)
  if (parts.explicitCount) bits.push(`${parts.explicitCount} named`)
  return bits.length ? bits.join(' · ') : 'Everyone'
}

/** Accept an ISO string, a Date, or nullish — and never throw on junk. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
