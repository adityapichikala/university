/**
 * Hostel — pure domain rules (Phase 3, doc §7).
 *
 * No Prisma, no `@/` imports. Occupancy is derived from the allocation rows
 * rather than stored, so a room can never drift out of sync with its beds.
 */

export interface Occupancy {
  capacity: number
  /** Allocations with `vacatedAt === null`. */
  occupied: number
  available: number
  full: boolean
}

/**
 * Count only live allocations. `vacatedAt` is the soft-delete marker: history
 * is kept for audit, but a vacated bed is free.
 */
export function occupancy(capacity: number, liveAllocations: number): Occupancy {
  const occupied = Math.max(0, liveAllocations)
  const available = Math.max(0, capacity - occupied)
  return { capacity, occupied, available, full: available <= 0 }
}

export interface AllocationCheckInput {
  capacity: number
  liveAllocations: number
  /** Does the student already hold a live bed in this college? */
  studentHasLiveBed: boolean
  /** Same student, same room, already live — a duplicate row. */
  studentAlreadyInThisRoom: boolean
}

/**
 * Can this student be given a bed in this room?
 * Returns the reason on failure so the API can answer 409 with a real message.
 */
export function canAllocate(
  input: AllocationCheckInput
): { ok: true } | { ok: false; reason: string } {
  if (input.studentAlreadyInThisRoom) {
    return { ok: false, reason: 'Student already has a live allocation in this room' }
  }
  if (input.studentHasLiveBed) {
    return { ok: false, reason: 'Student already occupies a bed — vacate it first' }
  }
  const room = occupancy(input.capacity, input.liveAllocations)
  if (room.full) {
    return { ok: false, reason: `Room is full (${room.capacity}/${room.capacity})` }
  }
  return { ok: true }
}

/** "A-204" style label from the block + number columns. */
export function roomLabel(block: string, roomNumber: string): string {
  return `${block}-${roomNumber}`
}

/** Human summary for list rows: "2 / 3 beds taken". */
export function occupancyLabel(occ: Occupancy): string {
  return `${occ.occupied} / ${occ.capacity} beds`
}
