import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES } from '../lib/roles'
import { gradeFromPercentage } from '../lib/academics'
import { feeStatusFor } from '../lib/fees'
import { computeFine, defaultDueDate } from '../lib/library'

const prisma = new PrismaClient()

const COLLEGE_ID = 'clg_apex'
const DEPARTMENT_ID = 'dep_cse'
const DEMO_PASSWORD = 'password123'

/**
 * Human descriptions for the admin UI. Every key in PERMISSIONS must land here
 * eventually, but the list below is documentation only — the rows actually
 * written to the DB are derived from PERMISSIONS so a new permission can never
 * be silently missing from the seed again.
 */
const PERMISSION_DESCRIPTIONS: Partial<Record<string, string>> = {
  [PERMISSIONS.GRADE_ENTRY]: 'Teacher may enter and edit marks',
  [PERMISSIONS.ATTENDANCE_MARK]: 'Teacher may mark attendance',
  [PERMISSIONS.EXAM_CREATE]: 'Teacher may create exams',
  [PERMISSIONS.LMS_ACCESS]: 'Student may use LMS features',
  [PERMISSIONS.EXAM_ENGINE_ACCESS]: 'Student may sit exams',
  [PERMISSIONS.VIRTUAL_LAB_ACCESS]: 'Student may use the virtual lab',
  [PERMISSIONS.USER_MANAGE]: 'Admin may create and manage users',
  [PERMISSIONS.COURSE_MANAGE]: 'Create and edit courses, assign teachers',
  [PERMISSIONS.CLASS_MANAGE]: 'Create and edit classes',
  [PERMISSIONS.ENROLLMENT_MANAGE]: 'Enroll or withdraw students',
  [PERMISSIONS.ASSIGNMENT_MANAGE]: 'Create and edit assignments',
  [PERMISSIONS.SUBMISSION_SUBMIT]: 'Student may submit assignment work',
  [PERMISSIONS.TIMETABLE_MANAGE]: 'Create and edit timetable slots',
  [PERMISSIONS.FEE_MANAGE]: 'Create fee structures, assign and collect fees',
  [PERMISSIONS.FEE_VIEW_OWN]: 'Student may view their own fee records',
  [PERMISSIONS.LIBRARY_MANAGE]: 'Manage the library catalog and issue books',
  [PERMISSIONS.LIBRARY_BORROW]: 'Borrow books from the library',
  [PERMISSIONS.HOSTEL_MANAGE]: 'Manage hostel rooms and allocations',
  [PERMISSIONS.HOSTEL_VIEW_OWN]: 'Student may view their own room allocation',
}

const PERMISSION_SEED = Object.values(PERMISSIONS).map((key) => ({
  key,
  description: PERMISSION_DESCRIPTIONS[key] ?? key,
}))

const DEMO_USERS = [
  { regno: 'STU001', name: 'Aarav Sharma', email: 'stu001@apex.edu', role: 'STUDENT' },
  { regno: 'TCH001', name: 'Dr. Priya Nair', email: 'tch001@apex.edu', role: 'TEACHER' },
  { regno: 'ADM001', name: 'Rakesh Menon', email: 'adm001@apex.edu', role: 'ADMIN' },
]

async function main() {
  // ── College & department ───────────────────────────────────────────────────
  await prisma.college.upsert({
    where: { id: COLLEGE_ID },
    update: {},
    create: {
      id: COLLEGE_ID,
      name: 'Apex University',
      address: '1 Knowledge Park, Bengaluru, Karnataka',
    },
  })

  await prisma.department.upsert({
    where: { id: DEPARTMENT_ID },
    update: {},
    create: { id: DEPARTMENT_ID, name: 'Computer Science & Engineering', collegeId: COLLEGE_ID },
  })

  // ── Tier 2: permissions ────────────────────────────────────────────────────
  for (const permission of PERMISSION_SEED) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    })
  }

  // ── Tier 2: default role → permission grants ───────────────────────────────
  for (const role of ROLES) {
    for (const key of DEFAULT_ROLE_PERMISSIONS[role]) {
      const permission = await prisma.permission.findUnique({ where: { key } })
      // Loud on purpose: a grant pointing at a key that is not in PERMISSIONS
      // is a code bug, and silently skipping it would look like "no access".
      if (!permission) throw new Error(`DEFAULT_ROLE_PERMISSIONS[${role}] references unknown permission "${key}"`)
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role, permissionId: permission.id } },
        update: {},
        create: { role, permissionId: permission.id },
      })
    }
  }

  // ── Users: one per key role ────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  for (const user of DEMO_USERS) {
    await prisma.user.upsert({
      where: { regno: user.regno },
      update: { role: user.role, collegeId: COLLEGE_ID, departmentId: DEPARTMENT_ID },
      create: {
        ...user,
        passwordHash,
        collegeId: COLLEGE_ID,
        departmentId: DEPARTMENT_ID,
        status: 'ACTIVE',
      },
    })
  }

  // ── Wave 1: academics ──────────────────────────────────────────────────────
  const teacher = await prisma.user.findUnique({ where: { regno: 'TCH001' } })
  const student = await prisma.user.findUnique({ where: { regno: 'STU001' } })

  if (teacher && student) {
    // One class (section) that students belong to.
    const klass = await prisma.class.upsert({
      where: { collegeId_name: { collegeId: COLLEGE_ID, name: 'CSE-A' } },
      update: {},
      create: {
        name: 'CSE-A',
        collegeId: COLLEGE_ID,
        departmentId: DEPARTMENT_ID,
        semester: 5,
        batchYear: 2024,
      },
    })

    // Three courses. TCH001 teaches two of them — the third proves that the
    // teacher's Tier-3 scope really does hide rows they don't own.
    const courseSpecs = [
      { code: 'CS501', name: 'Data Structures & Algorithms', credits: 4, mine: true },
      { code: 'CS502', name: 'Database Management Systems', credits: 3, mine: true },
      { code: 'CS503', name: 'Computer Networks', credits: 3, mine: false },
    ]

    for (const spec of courseSpecs) {
      const course = await prisma.course.upsert({
        where: { collegeId_code: { collegeId: COLLEGE_ID, code: spec.code } },
        update: {
          name: spec.name,
          credits: spec.credits,
          teacherId: spec.mine ? teacher.id : null,
        },
        create: {
          code: spec.code,
          name: spec.name,
          credits: spec.credits,
          collegeId: COLLEGE_ID,
          departmentId: DEPARTMENT_ID,
          teacherId: spec.mine ? teacher.id : null,
        },
      })

      // Enroll the demo student in every course.
      await prisma.courseEnrollment.upsert({
        where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
        update: {},
        create: {
          collegeId: COLLEGE_ID,
          studentId: student.id,
          courseId: course.id,
          classId: klass.id,
        },
      })
    }
  }

  // ── Wave 2: attendance + exams ─────────────────────────────────────────────
  if (teacher && student) {
    const taughtCourses = await prisma.course.findMany({
      where: { collegeId: COLLEGE_ID, teacherId: teacher.id },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    })

    // Ten weekday sessions of attendance across the two taught courses.
    // A deliberate ABSENT here and there so the student's percentage is not 100%.
    const pattern = ['PRESENT', 'PRESENT', 'LATE', 'PRESENT', 'ABSENT', 'PRESENT', 'PRESENT']
    const start = new Date('2026-09-01T00:00:00.000Z')
    for (const course of taughtCourses) {
      for (let i = 0; i < pattern.length; i++) {
        const date = new Date(start)
        date.setUTCDate(start.getUTCDate() + i)
        await prisma.attendance.upsert({
          where: {
            studentId_courseId_date: { studentId: student.id, courseId: course.id, date },
          },
          update: { status: pattern[i] },
          create: {
            collegeId: COLLEGE_ID,
            studentId: student.id,
            courseId: course.id,
            date,
            status: pattern[i],
          },
        })
      }
    }

    // Two exams on CS501: one published (student sees it), one not.
    const cs501 = taughtCourses.find((c) => c.code === 'CS501')
    if (cs501) {
      const published = await prisma.exam.upsert({
        where: { id: 'exam_cs501_midterm' },
        update: {},
        create: {
          id: 'exam_cs501_midterm',
          collegeId: COLLEGE_ID,
          courseId: cs501.id,
          examType: 'MIDTERM',
          examDate: new Date('2026-08-15T00:00:00.000Z'),
          maxMarks: 100,
        },
      })
      await prisma.examResult.upsert({
        where: { examId_studentId: { examId: published.id, studentId: student.id } },
        update: {},
        create: {
          collegeId: COLLEGE_ID,
          examId: published.id,
          studentId: student.id,
          marksObtained: 82,
          grade: 'A+',
          publishedAt: new Date('2026-08-20T00:00:00.000Z'),
        },
      })

      // Same setup, but publishedAt stays null — must never reach the student.
      const draft = await prisma.exam.upsert({
        where: { id: 'exam_cs501_endterm' },
        update: {},
        create: {
          id: 'exam_cs501_endterm',
          collegeId: COLLEGE_ID,
          courseId: cs501.id,
          examType: 'ENDTERM',
          examDate: new Date('2026-09-05T00:00:00.000Z'),
          maxMarks: 100,
        },
      })
      await prisma.examResult.upsert({
        where: { examId_studentId: { examId: draft.id, studentId: student.id } },
        update: { publishedAt: null },
        create: {
          collegeId: COLLEGE_ID,
          examId: draft.id,
          studentId: student.id,
          marksObtained: 91,
          grade: 'O',
          publishedAt: null,
        },
      })
    }
  }

  // ── Governance dashboard: faculty, cohorts, sections, one deliberate lock ──
  // The privilege matrix and section panel need more than one row each to be
  // worth looking at, and the seeded lock/denial proves the KPI counters and
  // the Tier-3 section filter actually bite.
  const EXTRA_USERS = [
    { regno: 'TCH002', name: 'Dr. Arjun Rao', email: 'tch002@apex.edu', role: 'TEACHER' },
    { regno: 'TCH003', name: 'Prof. Meera Iyer', email: 'tch003@apex.edu', role: 'TEACHER' },
    { regno: 'STU002', name: 'Ishita Verma', email: 'stu002@apex.edu', role: 'STUDENT' },
    { regno: 'STU003', name: 'Kabir Menon', email: 'stu003@apex.edu', role: 'STUDENT' },
    { regno: 'STU004', name: 'Ananya Pillai', email: 'stu004@apex.edu', role: 'STUDENT' },
    { regno: 'STU005', name: 'Rohan Gupta', email: 'stu005@apex.edu', role: 'STUDENT' },
    // Phase 3 officers — each owns exactly one service module.
    { regno: 'FIN001', name: 'Suresh Bhat', email: 'fin001@apex.edu', role: 'FINANCE' },
    { regno: 'LIB001', name: 'Latha Krishnan', email: 'lib001@apex.edu', role: 'LIBRARIAN' },
    { regno: 'WDN001', name: 'Joseph Fernandes', email: 'wdn001@apex.edu', role: 'WARDEN' },
  ]

  for (const user of EXTRA_USERS) {
    await prisma.user.upsert({
      where: { regno: user.regno },
      update: { role: user.role, collegeId: COLLEGE_ID, departmentId: DEPARTMENT_ID },
      create: {
        ...user,
        passwordHash,
        collegeId: COLLEGE_ID,
        departmentId: DEPARTMENT_ID,
        status: 'ACTIVE',
      },
    })
  }

  const extraTeacher = await prisma.user.findUnique({ where: { regno: 'TCH002' } })

  // Two more cohorts. CSE-C is a junior semester so the section matrix has
  // visibly different sections to switch on and off.
  const cohortSpecs = [
    { name: 'CSE-B', semester: 5 },
    { name: 'CSE-C', semester: 3 },
  ]
  const cohorts: Record<string, string> = {}
  const cseA = await prisma.class.findUnique({
    where: { collegeId_name: { collegeId: COLLEGE_ID, name: 'CSE-A' } },
    select: { id: true },
  })
  if (cseA) cohorts['CSE-A'] = cseA.id

  for (const spec of cohortSpecs) {
    const created = await prisma.class.upsert({
      where: { collegeId_name: { collegeId: COLLEGE_ID, name: spec.name } },
      update: { semester: spec.semester },
      create: {
        name: spec.name,
        collegeId: COLLEGE_ID,
        departmentId: DEPARTMENT_ID,
        semester: spec.semester,
        batchYear: 2024,
      },
    })
    cohorts[spec.name] = created.id
  }

  // Hand CS503 (the unassigned course) to TCH002 so the matrix has a second
  // teacher with something to lose.
  if (extraTeacher) {
    await prisma.course.updateMany({
      where: { collegeId: COLLEGE_ID, code: 'CS503' },
      data: { teacherId: extraTeacher.id },
    })
  }

  // Spread the extra students across courses and sections.
  const allCourses = await prisma.course.findMany({
    where: { collegeId: COLLEGE_ID },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  })
  const roster = [
    { regno: 'STU002', section: 'CSE-A' },
    { regno: 'STU003', section: 'CSE-A' },
    { regno: 'STU004', section: 'CSE-B' },
    { regno: 'STU005', section: 'CSE-C' },
  ]

  for (const entry of roster) {
    const learner = await prisma.user.findUnique({ where: { regno: entry.regno } })
    const classId = cohorts[entry.section]
    if (!learner || !classId) continue

    for (const course of allCourses) {
      await prisma.courseEnrollment.upsert({
        where: { studentId_courseId: { studentId: learner.id, courseId: course.id } },
        update: { classId },
        create: { collegeId: COLLEGE_ID, studentId: learner.id, courseId: course.id, classId },
      })
    }
  }

  // Deliberate security restriction #1: CSE-C is locked out of CS503.
  // Toggling it back on in the UI should make the course reappear for them.
  const cs503 = allCourses.find((c) => c.code === 'CS503')
  if (cs503 && cohorts['CSE-C']) {
    await prisma.courseSectionAccess.upsert({
      where: { courseId_classId: { courseId: cs503.id, classId: cohorts['CSE-C'] } },
      update: { enabled: false },
      create: {
        collegeId: COLLEGE_ID,
        courseId: cs503.id,
        classId: cohorts['CSE-C'],
        enabled: false,
      },
    })
  }

  // Deliberate security restriction #2: TCH002 may not enter grades.
  if (extraTeacher) {
    const gradePermission = await prisma.permission.findUnique({
      where: { key: PERMISSIONS.GRADE_ENTRY },
      select: { id: true },
    })
    if (gradePermission) {
      await prisma.userPermission.upsert({
        where: {
          userId_permissionId: { userId: extraTeacher.id, permissionId: gradePermission.id },
        },
        update: { granted: false },
        create: { userId: extraTeacher.id, permissionId: gradePermission.id, granted: false },
      })
    }
  }

  // ── Wave 3: assignments → submissions → grades ─────────────────────────────
  const tch001 = await prisma.user.findUnique({ where: { regno: 'TCH001' } })
  if (tch001) {
    const day = 24 * 60 * 60 * 1000
    const now = Date.now()
    /** Due at 23:59:59 UTC on the day `offset` days from today. */
    const dueIn = (offset: number) => new Date(new Date(now + offset * day).setUTCHours(23, 59, 59, 0))

    const assignmentSpecs = [
      {
        code: 'CS501',
        title: 'Sorting benchmark report',
        description:
          'Implement quicksort and mergesort, benchmark both on 10k/100k/1M integers and explain where each wins.',
        offset: 4,
        maxMarks: 100,
      },
      {
        code: 'CS501',
        title: 'Graph traversal worksheet',
        description:
          'Trace BFS and DFS on the supplied adjacency list and hand in the visit order for each.',
        offset: -6,
        maxMarks: 50,
      },
      {
        code: 'CS502',
        title: 'Normalise the enrolment schema',
        description:
          'Take the denormalised enrolment table up to BCNF. Show each dependency you removed.',
        offset: 2,
        maxMarks: 100,
      },
      {
        code: 'CS503',
        title: 'Subnetting drill',
        description: 'Split 10.0.0.0/16 into the eight subnets listed in the brief.',
        offset: 1,
        maxMarks: 40,
      },
    ]

    for (const spec of assignmentSpecs) {
      const course = allCourses.find((c) => c.code === spec.code)
      if (!course) continue

      const owner = await prisma.course.findUnique({
        where: { id: course.id },
        select: { teacherId: true },
      })
      const teacherId = owner?.teacherId ?? tch001.id

      // Stable surrogate key so re-seeding updates instead of duplicating.
      const assignmentId = `asg_${spec.code.toLowerCase()}_${spec.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 24)}`

      const assignment = await prisma.assignment.upsert({
        where: { id: assignmentId },
        update: {
          title: spec.title,
          description: spec.description,
          dueDate: dueIn(spec.offset),
          maxMarks: spec.maxMarks,
          teacherId,
          courseId: course.id,
        },
        create: {
          id: assignmentId,
          collegeId: COLLEGE_ID,
          courseId: course.id,
          teacherId,
          title: spec.title,
          description: spec.description,
          dueDate: dueIn(spec.offset),
          maxMarks: spec.maxMarks,
          allowedFileTypes: 'pdf,docx,zip',
        },
        select: { id: true, maxMarks: true },
      })

      // STU001 hands in the overdue worksheet (already graded) and nothing
      // else — so their feed has one graded card, one to-do and one late risk.
      // STU002 submits the normalisation work but is still awaiting a grade.
      const handIns = [
        { regno: 'STU001', title: 'Graph traversal worksheet', fileUrl: 'https://github.com/aarav/graph-traversal', score: 44, feedback: 'Clean traces. Lost marks on the DFS visit order for node F.' },
        { regno: 'STU002', title: 'Normalise the enrolment schema', fileUrl: 'https://github.com/ishaan/bcnf-enrolment', score: null, feedback: null as string | null },
      ]

      for (const handIn of handIns) {
        if (spec.title !== handIn.title) continue
        const learner = await prisma.user.findUnique({ where: { regno: handIn.regno } })
        if (!learner) continue

        const submittedAt = new Date(now - 3 * day)
        const submission = await prisma.submission.upsert({
          where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: learner.id } },
          update: { fileUrl: handIn.fileUrl, submittedAt },
          create: {
            collegeId: COLLEGE_ID,
            assignmentId: assignment.id,
            studentId: learner.id,
            fileUrl: handIn.fileUrl,
            submittedAt,
            status: submittedAt > dueIn(spec.offset) ? 'LATE' : 'SUBMITTED',
          },
          select: { id: true },
        })

        if (handIn.score !== null) {
          await prisma.grade.upsert({
            where: { submissionId: submission.id },
            update: { score: handIn.score, feedback: handIn.feedback },
            create: {
              collegeId: COLLEGE_ID,
              submissionId: submission.id,
              score: handIn.score,
              feedback: handIn.feedback,
              gradedByUserId: teacherId,
            },
          })
          await prisma.submission.update({
            where: { id: submission.id },
            data: { status: 'GRADED' },
          })
        }
      }
    }
  }

  // ── Wave 4: timetable ──────────────────────────────────────────────────────
  // A realistic week for CSE-A / CSE-B. Deterministic ids keep re-seeding
  // idempotent, and `skipConflicts` means a hand-edited timetable is left alone
  // rather than being overwritten every run.
  const TIMETABLE: Array<{
    course: string
    section: string
    day: number
    start: string
    end: string
    room: string
  }> = [
    { course: 'CS501', section: 'CSE-A', day: 1, start: '09:00', end: '10:00', room: 'A-204' },
    { course: 'CS502', section: 'CSE-A', day: 1, start: '10:00', end: '11:00', room: 'A-204' },
    { course: 'CS501', section: 'CSE-A', day: 2, start: '11:00', end: '12:00', room: 'A-204' },
    { course: 'CS503', section: 'CSE-A', day: 3, start: '09:00', end: '10:00', room: 'B-101' },
    { course: 'CS502', section: 'CSE-A', day: 4, start: '14:00', end: '16:00', room: 'Lab-2' },
    { course: 'CS501', section: 'CSE-A', day: 5, start: '09:00', end: '10:00', room: 'A-204' },
    { course: 'CS503', section: 'CSE-A', day: 5, start: '15:00', end: '16:00', room: 'B-101' },

    { course: 'CS501', section: 'CSE-B', day: 1, start: '11:00', end: '12:00', room: 'A-205' },
    { course: 'CS502', section: 'CSE-B', day: 2, start: '09:00', end: '10:00', room: 'A-205' },
    { course: 'CS503', section: 'CSE-B', day: 4, start: '10:00', end: '11:00', room: 'B-101' },
    { course: 'CS501', section: 'CSE-B', day: 5, start: '14:00', end: '16:00', room: 'Lab-2' },
  ]

  for (const entry of TIMETABLE) {
    const course = allCourses.find((c) => c.code === entry.course)
    const classId = cohorts[entry.section]
    if (!course || !classId) continue

    const owner = await prisma.course.findUnique({
      where: { id: course.id },
      select: { teacherId: true },
    })
    if (!owner?.teacherId) continue

    const id = `tt_${entry.section.toLowerCase()}_${entry.course.toLowerCase()}_${entry.day}_${entry.start.replace(':', '')}`

    const existing = await prisma.timetableSlot.findUnique({ where: { id } })
    if (existing) continue

    await prisma.timetableSlot.create({
      data: {
        id,
        collegeId: COLLEGE_ID,
        courseId: course.id,
        classId,
        dayOfWeek: entry.day,
        startTime: entry.start,
        endTime: entry.end,
        room: entry.room,
      },
    })
  }

  // ── Phase 2: exams & published results → CGPA ──────────────────────────────
  // Course.credits has been sitting unused since Wave 1. These published
  // results give the transcript something real to weigh.
  //
  // STU001 works out by hand to:
  //   CS501 (4cr) 82 + 91 → 86.5% → A+ →  9 → 36
  //   CS502 (3cr) 68 + 74 → 71.0% → A  →  8 → 24
  //   CS503 (3cr) 45      → 45.0% → C  →  5 → 15
  //   Σ 75 / 10 credits = CGPA 7.5
  const EXAM_SPECS = [
    { code: 'CS501', type: 'MIDTERM', date: '2026-08-15', maxMarks: 100 },
    { code: 'CS501', type: 'ENDTERM', date: '2026-09-05', maxMarks: 100 },
    { code: 'CS502', type: 'MIDTERM', date: '2026-08-18', maxMarks: 100 },
    { code: 'CS502', type: 'ENDTERM', date: '2026-09-08', maxMarks: 100 },
    { code: 'CS503', type: 'MIDTERM', date: '2026-08-20', maxMarks: 100 },
  ]

  const RESULT_SPECS = [
    { regno: 'STU001', code: 'CS501', type: 'MIDTERM', marks: 82, publish: true },
    { regno: 'STU001', code: 'CS501', type: 'ENDTERM', marks: 91, publish: true },
    { regno: 'STU001', code: 'CS502', type: 'MIDTERM', marks: 68, publish: true },
    { regno: 'STU001', code: 'CS502', type: 'ENDTERM', marks: 74, publish: true },
    { regno: 'STU001', code: 'CS503', type: 'MIDTERM', marks: 45, publish: true },

    // A second transcript so teacher/admin lookups have something to compare.
    { regno: 'STU002', code: 'CS501', type: 'MIDTERM', marks: 55, publish: true },
    { regno: 'STU002', code: 'CS501', type: 'ENDTERM', marks: 61, publish: true },
    { regno: 'STU002', code: 'CS502', type: 'MIDTERM', marks: 88, publish: true },
    // Deliberately NOT published — proves the transcript ignores unpublished work.
    { regno: 'STU002', code: 'CS502', type: 'ENDTERM', marks: 95, publish: false },

    // A failing grade, to prove F credits stay in the CGPA denominator.
    { regno: 'STU003', code: 'CS501', type: 'MIDTERM', marks: 35, publish: true },
    { regno: 'STU003', code: 'CS502', type: 'MIDTERM', marks: 72, publish: true },
  ]

  const examIds = new Map<string, string>()
  const examMax = new Map<string, number>()
  for (const spec of EXAM_SPECS) {
    const course = allCourses.find((c) => c.code === spec.code)
    if (!course) continue

    const examDate = new Date(`${spec.date}T00:00:00.000Z`)
    const existing = await prisma.exam.findFirst({
      where: { courseId: course.id, examType: spec.type },
      select: { id: true, maxMarks: true },
    })

    const exam = existing
      ? await prisma.exam.update({
          where: { id: existing.id },
          data: { maxMarks: spec.maxMarks, examDate },
          select: { id: true },
        })
      : await prisma.exam.create({
          data: {
            collegeId: COLLEGE_ID,
            courseId: course.id,
            examType: spec.type,
            examDate,
            maxMarks: spec.maxMarks,
          },
          select: { id: true },
        })

    examIds.set(`${spec.code}:${spec.type}`, exam.id)
    examMax.set(`${spec.code}:${spec.type}`, spec.maxMarks)
  }

  for (const spec of RESULT_SPECS) {
    const examId = examIds.get(`${spec.code}:${spec.type}`)
    if (!examId) continue
    const learner = await prisma.user.findUnique({
      where: { regno: spec.regno },
      select: { id: true },
    })
    if (!learner) continue

    const pct = (spec.marks / (examMax.get(`${spec.code}:${spec.type}`) ?? 100)) * 100
    const data = {
      marksObtained: spec.marks,
      grade: gradeFromPercentage(pct),
      publishedAt: spec.publish ? new Date('2026-09-09T00:00:00.000Z') : null,
    }

    await prisma.examResult.upsert({
      where: { examId_studentId: { examId, studentId: learner.id } },
      update: data,
      create: { collegeId: COLLEGE_ID, examId, studentId: learner.id, ...data },
    })
  }

  // ── Phase 3: Fees ──────────────────────────────────────────────────────────
  const finance = await prisma.user.findUnique({ where: { regno: 'FIN001' }, select: { id: true } })

  // One due date is deliberately in the past so OVERDUE is visible on day one.
  const FEE_STRUCTURES = [
    { key: 'sem5', programName: 'B.Tech CSE — Semester 5', batchYear: 2024, amount: 85000, dueDate: '2026-08-31' },
    { key: 'sem3', programName: 'B.Tech CSE — Semester 3', batchYear: 2024, amount: 78000, dueDate: '2026-11-30' },
    { key: 'hostel', programName: 'Hostel & Mess (Annual)', batchYear: 2024, amount: 62000, dueDate: '2026-10-15' },
  ]

  const structureIds = new Map<string, string>()
  const structureDue = new Map<string, Date>()
  for (const spec of FEE_STRUCTURES) {
    const dueDate = new Date(`${spec.dueDate}T23:59:59.000Z`)
    const existing = await prisma.feeStructure.findFirst({
      where: { collegeId: COLLEGE_ID, programName: spec.programName, batchYear: spec.batchYear },
      select: { id: true },
    })
    const structure = existing
      ? await prisma.feeStructure.update({
          where: { id: existing.id },
          data: { amount: spec.amount, dueDate },
          select: { id: true },
        })
      : await prisma.feeStructure.create({
          data: {
            collegeId: COLLEGE_ID,
            programName: spec.programName,
            batchYear: spec.batchYear,
            amount: spec.amount,
            dueDate,
          },
          select: { id: true },
        })
    structureIds.set(spec.key, structure.id)
    structureDue.set(spec.key, dueDate)
  }

  /**
   * `installments` are recorded as real FeePayment rows — FeeRecord.amountPaid
   * is only the cached sum. That is what makes the student's ledger meaningful
   * rather than a single opaque number.
   */
  const FEE_RECORDS: {
    regno: string
    structure: string
    installments: { amount: number; daysAgo: number; ref: string; method: string }[]
    waiverReason?: string
  }[] = [
    {
      // Fully paid in three installments → PAID.
      regno: 'STU001',
      structure: 'sem5',
      installments: [
        { amount: 30000, daysAgo: 60, ref: 'TXN-APX-1001', method: 'UPI' },
        { amount: 30000, daysAgo: 35, ref: 'TXN-APX-1042', method: 'NETBANKING' },
        { amount: 25000, daysAgo: 12, ref: 'TXN-APX-1188', method: 'CARD' },
      ],
    },
    {
      // Part-paid against a future due date → PARTIAL (not yet overdue).
      regno: 'STU001',
      structure: 'hostel',
      installments: [{ amount: 20000, daysAgo: 20, ref: 'TXN-APX-1077', method: 'UPI' }],
    },
    {
      // Nothing paid, due date has passed → OVERDUE.
      regno: 'STU002',
      structure: 'sem5',
      installments: [],
    },
    {
      // Nothing paid, due date in the future → PENDING.
      regno: 'STU002',
      structure: 'sem3',
      installments: [],
    },
    {
      // Part-paid and past due → OVERDUE (partial does not excuse lateness).
      regno: 'STU003',
      structure: 'sem5',
      installments: [{ amount: 40000, daysAgo: 70, ref: 'TXN-APX-0990', method: 'CHEQUE' }],
    },
    {
      // Waived — a full scholarship on hostel fees.
      regno: 'STU003',
      structure: 'hostel',
      installments: [],
      waiverReason: 'Merit scholarship — full hostel waiver',
    },
  ]

  const seedNow = new Date()
  const daysAgo = (n: number) => new Date(seedNow.getTime() - n * 86_400_000)

  for (const spec of FEE_RECORDS) {
    const learner = await prisma.user.findUnique({
      where: { regno: spec.regno },
      select: { id: true },
    })
    const structureId = structureIds.get(spec.structure)
    if (!learner || !structureId) continue

    const amountDue = FEE_STRUCTURES.find((s) => s.key === spec.structure)!.amount
    const amountPaid = spec.installments.reduce((sum, i) => sum + i.amount, 0)
    const lastPayment = spec.installments.at(-1)
    const status = feeStatusFor({
      amountDue,
      amountPaid,
      dueDate: structureDue.get(spec.structure)!,
      waived: Boolean(spec.waiverReason),
      now: seedNow,
    })

    const record = await prisma.feeRecord.upsert({
      where: { studentId_feeStructureId: { studentId: learner.id, feeStructureId: structureId } },
      update: {
        amountPaid,
        status,
        waiverReason: spec.waiverReason ?? null,
        paymentDate: lastPayment ? daysAgo(lastPayment.daysAgo) : null,
      },
      create: {
        collegeId: COLLEGE_ID,
        studentId: learner.id,
        feeStructureId: structureId,
        amountPaid,
        status,
        waiverReason: spec.waiverReason ?? null,
        paymentDate: lastPayment ? daysAgo(lastPayment.daysAgo) : null,
        transactionRef: lastPayment?.ref ?? null,
      },
      select: { id: true },
    })

    // Idempotent ledger: wipe and rebuild this record's installments so a
    // re-seed reflects the spec above instead of accumulating duplicates.
    await prisma.feePayment.deleteMany({ where: { feeRecordId: record.id } })
    for (const installment of spec.installments) {
      await prisma.feePayment.create({
        data: {
          collegeId: COLLEGE_ID,
          feeRecordId: record.id,
          amount: installment.amount,
          paidAt: daysAgo(installment.daysAgo),
          transactionRef: installment.ref,
          method: installment.method,
          receivedById: finance?.id ?? null,
        },
      })
    }
  }

  // ── Phase 3: Library ───────────────────────────────────────────────────────
  const CATALOG = [
    { key: 'osc', title: 'Operating System Concepts', author: 'Silberschatz, Galvin, Gagne', isbn: '978-1118063330', totalCopies: 4 },
    { key: 'clrs', title: 'Introduction to Algorithms', author: 'Cormen, Leiserson, Rivest, Stein', isbn: '978-0262033848', totalCopies: 3 },
    { key: 'clean', title: 'Clean Code', author: 'Robert C. Martin', isbn: '978-0132350884', totalCopies: 2 },
    { key: 'cn', title: 'Computer Networks', author: 'Andrew S. Tanenbaum', isbn: '978-0132126953', totalCopies: 3 },
    { key: 'dbms', title: 'Database System Concepts', author: 'Silberschatz, Korth, Sudarshan', isbn: '978-0078022159', totalCopies: 5 },
    { key: 'sapiens', title: 'Sapiens: A Brief History of Humankind', author: 'Yuval Noah Harari', isbn: '978-0062316097', totalCopies: 2 },
  ]

  const itemIds = new Map<string, string>()
  for (const spec of CATALOG) {
    const existing = await prisma.libraryItem.findFirst({
      where: { collegeId: COLLEGE_ID, title: spec.title },
      select: { id: true },
    })
    const item = existing
      ? await prisma.libraryItem.update({
          where: { id: existing.id },
          data: { author: spec.author, isbn: spec.isbn, totalCopies: spec.totalCopies },
          select: { id: true },
        })
      : await prisma.libraryItem.create({
          data: {
            collegeId: COLLEGE_ID,
            title: spec.title,
            author: spec.author,
            isbn: spec.isbn,
            totalCopies: spec.totalCopies,
            availableCopies: spec.totalCopies,
          },
          select: { id: true },
        })
    itemIds.set(spec.key, item.id)
  }

  /**
   * Loans. `daysOut` / `returnedAfter` are relative to seed time so the demo
   * always shows one ACTIVE, one OVERDUE and two RETURNED (one with a fine).
   */
  const ISSUES = [
    { regno: 'STU001', item: 'osc', daysAgo: 20, returnedAfter: null }, // 6 days overdue
    { regno: 'STU001', item: 'clean', daysAgo: 3, returnedAfter: null }, // comfortably on time
    { regno: 'STU002', item: 'clrs', daysAgo: 40, returnedAfter: 12 }, // returned early, no fine
    { regno: 'STU003', item: 'cn', daysAgo: 30, returnedAfter: 19 }, // 5 days late → ₹25
    { regno: 'STU002', item: 'sapiens', daysAgo: 8, returnedAfter: null }, // due in 6 days
  ]

  // Rebuild the loan book each seed so `availableCopies` can be recomputed
  // from scratch instead of drifting by whatever ran last.
  await prisma.libraryIssue.deleteMany({ where: { collegeId: COLLEGE_ID } })

  for (const spec of ISSUES) {
    const learner = await prisma.user.findUnique({
      where: { regno: spec.regno },
      select: { id: true },
    })
    const itemId = itemIds.get(spec.item)
    if (!learner || !itemId) continue

    const issuedAt = daysAgo(spec.daysAgo)
    const dueAt = defaultDueDate(issuedAt)
    const returnedAt = spec.returnedAfter === null ? null : daysAgo(spec.daysAgo - spec.returnedAfter)

    await prisma.libraryIssue.create({
      data: {
        collegeId: COLLEGE_ID,
        itemId,
        studentId: learner.id,
        issuedAt,
        dueAt,
        returnedAt,
        fineAmount: computeFine(dueAt, returnedAt),
      },
    })
  }

  // Recompute the shelf from the loans actually on it — never trust a counter.
  for (const [key, itemId] of itemIds) {
    const onLoan = await prisma.libraryIssue.count({ where: { itemId, returnedAt: null } })
    const total = CATALOG.find((c) => c.key === key)!.totalCopies
    await prisma.libraryItem.update({
      where: { id: itemId },
      data: { totalCopies: total, availableCopies: Math.max(0, total - onLoan) },
    })
  }

  // ── Phase 3: Hostel ────────────────────────────────────────────────────────
  const ROOMS = [
    { key: 'a101', block: 'A', roomNumber: '101', capacity: 3 },
    { key: 'a102', block: 'A', roomNumber: '102', capacity: 3 },
    { key: 'a201', block: 'A', roomNumber: '201', capacity: 2 },
    { key: 'b101', block: 'B', roomNumber: '101', capacity: 4 },
  ]

  const roomIds = new Map<string, string>()
  for (const spec of ROOMS) {
    const room = await prisma.hostelRoom.upsert({
      where: {
        collegeId_block_roomNumber: {
          collegeId: COLLEGE_ID,
          block: spec.block,
          roomNumber: spec.roomNumber,
        },
      },
      update: { capacity: spec.capacity },
      create: {
        collegeId: COLLEGE_ID,
        block: spec.block,
        roomNumber: spec.roomNumber,
        capacity: spec.capacity,
      },
      select: { id: true },
    })
    roomIds.set(spec.key, room.id)
  }

  /**
   * One student per bed. STU005's row is already vacated — proof that a
   * vacated bed frees capacity while the history stays for audit.
   */
  const ALLOCATIONS = [
    { regno: 'STU001', room: 'a101', daysAgo: 120, vacatedAfter: null },
    { regno: 'STU002', room: 'a101', daysAgo: 118, vacatedAfter: null },
    { regno: 'STU003', room: 'a102', daysAgo: 100, vacatedAfter: null },
    { regno: 'STU004', room: 'a201', daysAgo: 90, vacatedAfter: null },
    { regno: 'STU005', room: 'a102', daysAgo: 200, vacatedAfter: 40 },
  ]

  await prisma.hostelAllocation.deleteMany({ where: { collegeId: COLLEGE_ID } })

  for (const spec of ALLOCATIONS) {
    const learner = await prisma.user.findUnique({
      where: { regno: spec.regno },
      select: { id: true },
    })
    const roomId = roomIds.get(spec.room)
    if (!learner || !roomId) continue

    await prisma.hostelAllocation.create({
      data: {
        collegeId: COLLEGE_ID,
        studentId: learner.id,
        roomId,
        allocatedAt: daysAgo(spec.daysAgo),
        vacatedAt: spec.vacatedAfter === null ? null : daysAgo(spec.vacatedAfter),
      },
    })
  }

  console.log('\n  Seed complete')
  console.log('  ─────────────────────────────────────────')
  for (const user of [...DEMO_USERS, ...EXTRA_USERS]) {
    console.log(`  ${user.regno.padEnd(8)} ${user.role.padEnd(9)} password: ${DEMO_PASSWORD}`)
  }
  console.log('  ─────────────────────────────────────────\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
