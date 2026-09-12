import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  console.log('slots after reseed:', await p.timetableSlot.count())
  const byCourse: Record<string, number> = {}
  for (const s of await p.timetableSlot.findMany({ select: { course: { select: { code: true } } } })) byCourse[s.course.code] = (byCourse[s.course.code] ?? 0) + 1
  console.log('by course:', JSON.stringify(byCourse))
}
main().catch(e=>console.error(e)).finally(()=>p.$disconnect())
