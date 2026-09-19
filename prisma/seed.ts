import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES } from '../lib/roles'
import { gradeFromPercentage } from '../lib/academics'
import { feeStatusFor } from '../lib/fees'
import { computeFine, defaultDueDate } from '../lib/library'

/**
 * Retry transient connection drops (P1001/P1008/P1017) with backoff.
 *
 * The seed script is a long sequence of small sequential queries; over a
 * flaky network a single dropped connection mid-run would otherwise kill
 * the whole (idempotent, re-runnable, but slow to re-reach the same point)
 * process. Every query goes through this, so no call site needs to know.
 */
const prisma = new PrismaClient().$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      const maxAttempts = 8
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await query(args)
        } catch (err) {
          // Connection drops surface as either a known request error with a
          // P10xx code, or a PrismaClientInitializationError whose own code
          // can be undefined — so fall back to sniffing the message too.
          const code = (err as { code?: string; errorCode?: string })?.code
          const errorCode = (err as { errorCode?: string })?.errorCode
          const message = err instanceof Error ? err.message : ''
          const transient =
            code === 'P1001' ||
            code === 'P1008' ||
            code === 'P1017' ||
            errorCode === 'P1001' ||
            errorCode === 'P1017' ||
            message.includes("Can't reach database server") ||
            message.includes('Connection closed') ||
            message.includes('Connection reset')
          if (!transient || attempt === maxAttempts) throw err
          console.warn(
            `  [retry] ${model}.${operation} failed (${code ?? errorCode ?? 'connection error'}), attempt ${attempt}/${maxAttempts}`,
          )
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
      }
      throw new Error('unreachable')
    },
  },
})

const COLLEGE_ID = 'clg_apex'
const DEPARTMENT_ID = 'dep_cse'
/** Second department — see the note at its upsert for why it has to exist. */
const OTHER_DEPARTMENT_ID = 'dep_ecm'
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
  [PERMISSIONS.EMPLOYEE_MANAGE]: 'Maintain the employee register',
  [PERMISSIONS.LEAVE_APPROVE]: 'Approve or reject staff leave requests',
  [PERMISSIONS.LEAVE_REQUEST]: 'File a leave request for yourself',
  [PERMISSIONS.PLACEMENT_MANAGE]: 'Run placement drives and move applications through the pipeline',
  [PERMISSIONS.PLACEMENT_APPLY]: 'Apply to a placement drive',
  [PERMISSIONS.CERTIFICATE_ISSUE]: 'Issue bonafide, transcript and degree certificates',
  [PERMISSIONS.PARENT_VIEW_CHILD]: 'View your own child’s attendance, results and fees',
  [PERMISSIONS.DEPARTMENT_VIEW]: 'See everything in your own department',
  [PERMISSIONS.HOSTEL_VIEW_OWN]: 'Student may view their own room allocation',
  [PERMISSIONS.ANNOUNCEMENT_BROADCAST]: 'Post announcements scoped by role, department, class or student',
  [PERMISSIONS.DEPARTMENT_MANAGE]: 'Create and rename departments, and appoint a HOD',
  [PERMISSIONS.ADMISSION_MANAGE]: 'Decide admission applications and convert them into students',
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

  // A second department. Without one, the HOD's Tier-3 "only my department"
  // rule has nothing to exclude and can never actually fire — and HR's
  // headcount panel is a single bar. Both portals need the contrast.
  await prisma.department.upsert({
    where: { id: OTHER_DEPARTMENT_ID },
    update: {},
    create: {
      id: OTHER_DEPARTMENT_ID,
      name: 'Electronics & Communication',
      collegeId: COLLEGE_ID,
    },
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

    // ── Past-semester courses ──────────────────────────────────────────────────
    // A transcript that only ever spans one semester cannot show a CGPA trend,
    // and the semester-wise GPA table would collapse to a single row. These give
    // the demo cohort a completed semester to weigh against the current one.
    const pastCourseSpecs = [
      { code: 'CS301', name: 'Object-Oriented Programming', credits: 4 },
      { code: 'CS302', name: 'Discrete Mathematics', credits: 3 },
    ]

    for (const spec of pastCourseSpecs) {
      const course = await prisma.course.upsert({
        where: { collegeId_code: { collegeId: COLLEGE_ID, code: spec.code } },
        update: { name: spec.name, credits: spec.credits },
        create: {
          code: spec.code,
          name: spec.name,
          credits: spec.credits,
          collegeId: COLLEGE_ID,
          departmentId: DEPARTMENT_ID,
        },
      })

      // STU001 is enrolled above, before this block runs, so they are added here.
      // The others pick these up from the shared `allCourses` roster below.
      if (student) {
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
  const EXTRA_USERS: {
    regno: string
    name: string
    email: string
    role: string
    /** Defaults to the CSE department when omitted. */
    departmentId?: string
  }[] = [
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
    // Phase 4 staff portals — one account per remaining role so each portal is
    // actually reachable with a demo login.
    { regno: 'HOD001', name: 'Dr. Sunita Nair', email: 'hod001@apex.edu', role: 'HOD' },
    { regno: 'HR001', name: 'Priya Deshpande', email: 'hr001@apex.edu', role: 'HR' },
    { regno: 'REG001', name: 'Anil Chatterjee', email: 'reg001@apex.edu', role: 'REGISTRAR' },
    { regno: 'PLA001', name: 'Vikram Sethi', email: 'pla001@apex.edu', role: 'PLACEMENT' },
    { regno: 'PAR001', name: 'Mohan Menon', email: 'par001@apex.edu', role: 'PARENT' },
    // A second department's staff. TCH004 files a leave request that HOD001
    // (CSE) must be refused on — this is the Tier-3 rule in action.
    {
      regno: 'TCH004',
      name: 'Dr. Meera Iyer',
      email: 'tch004@apex.edu',
      role: 'TEACHER',
      departmentId: OTHER_DEPARTMENT_ID,
    },
    {
      regno: 'HOD002',
      name: 'Dr. Arjun Rao',
      email: 'hod002@apex.edu',
      role: 'HOD',
      departmentId: OTHER_DEPARTMENT_ID,
    },
  ]

  for (const user of EXTRA_USERS) {
    await prisma.user.upsert({
      where: { regno: user.regno },
      update: {
        role: user.role,
        collegeId: COLLEGE_ID,
        departmentId: user.departmentId ?? DEPARTMENT_ID,
      },
      create: {
        regno: user.regno,
        name: user.name,
        email: user.email,
        role: user.role,
        passwordHash,
        collegeId: COLLEGE_ID,
        departmentId: user.departmentId ?? DEPARTMENT_ID,
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
  // STU001 works out by hand to two semesters, so the CGPA is a real
  // credit-weighted average rather than one semester restated:
  //
  //   Semester 3 — CS301 (4cr) 64 + 70 → 67.0% → B+ → 7 → 28
  //                CS302 (3cr) 58      → 58.0% → B  → 6 → 18
  //                Σ 46 /  7 credits = GPA 6.57
  //
  //   Semester 5 — CS501 (4cr) 82 + 91 → 86.5% → A+ → 9 → 36
  //                CS502 (3cr) 68 + 74 → 71.0% → A  → 8 → 24
  //                CS503 (3cr) 45      → 45.0% → C  → 5 → 15
  //                Σ 75 / 10 credits = GPA 7.50
  //
  //   Overall    — Σ 121 / 17 credits = CGPA 7.12
  //                (equal to the credit-weighted mean of 6.57 and 7.50,
  //                 which is the identity the semester table must satisfy)
  const EXAM_SPECS = [
    { code: 'CS501', type: 'MIDTERM', date: '2026-08-15', maxMarks: 100 },
    { code: 'CS501', type: 'ENDTERM', date: '2026-09-05', maxMarks: 100 },
    { code: 'CS502', type: 'MIDTERM', date: '2026-08-18', maxMarks: 100 },
    { code: 'CS502', type: 'ENDTERM', date: '2026-09-08', maxMarks: 100 },
    { code: 'CS503', type: 'MIDTERM', date: '2026-08-20', maxMarks: 100 },

    // Semester 3 — a completed semester, so the transcript has two of them and
    // the CGPA is visibly a credit-weighted average rather than one semester's
    // result restated. Dated in the past, and already published.
    { code: 'CS301', type: 'MIDTERM', date: '2026-03-10', maxMarks: 100 },
    { code: 'CS301', type: 'ENDTERM', date: '2026-04-28', maxMarks: 100 },
    { code: 'CS302', type: 'ENDTERM', date: '2026-04-30', maxMarks: 100 },
  ]

  const RESULT_SPECS = [
    { regno: 'STU001', code: 'CS501', type: 'MIDTERM', marks: 82, publish: true },
    { regno: 'STU001', code: 'CS501', type: 'ENDTERM', marks: 91, publish: true },
    { regno: 'STU001', code: 'CS502', type: 'MIDTERM', marks: 68, publish: true },
    { regno: 'STU001', code: 'CS502', type: 'ENDTERM', marks: 74, publish: true },
    { regno: 'STU001', code: 'CS503', type: 'MIDTERM', marks: 45, publish: true },

    // STU001's Semester 3, deliberately weaker than Semester 5 so the CGPA
    // trend reads as an improvement:
    //   CS301 (4cr) 64 + 70 → 67.0% → B+ → 7 → 28
    //   CS302 (3cr) 58      → 58.0% → B  → 6 → 18
    //   Σ 46 / 7 credits = GPA 6.57
    { regno: 'STU001', code: 'CS301', type: 'MIDTERM', marks: 64, publish: true },
    { regno: 'STU001', code: 'CS301', type: 'ENDTERM', marks: 70, publish: true },
    { regno: 'STU001', code: 'CS302', type: 'ENDTERM', marks: 58, publish: true },

    // A second transcript so teacher/admin lookups have something to compare.
    { regno: 'STU002', code: 'CS501', type: 'MIDTERM', marks: 55, publish: true },
    { regno: 'STU002', code: 'CS501', type: 'ENDTERM', marks: 61, publish: true },
    { regno: 'STU002', code: 'CS502', type: 'MIDTERM', marks: 88, publish: true },
    // Deliberately NOT published — proves the transcript ignores unpublished work.
    { regno: 'STU002', code: 'CS502', type: 'ENDTERM', marks: 95, publish: false },
    { regno: 'STU002', code: 'CS301', type: 'ENDTERM', marks: 77, publish: true },

    // A failing grade, to prove F credits stay in the CGPA denominator.
    { regno: 'STU003', code: 'CS501', type: 'MIDTERM', marks: 35, publish: true },
    { regno: 'STU003', code: 'CS502', type: 'MIDTERM', marks: 72, publish: true },
    { regno: 'STU003', code: 'CS301', type: 'ENDTERM', marks: 41, publish: true },
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

  // ── Phase 4: Announcements ────────────────────────────────────────────────
  // Four notices that between them exercise every branch of the banner:
  // urgent-and-live, already-lapsed, role-targeted, and named-to-one-person.
  const broadcaster = await prisma.user.findUnique({
    where: { regno: 'TCH001' },
    select: { id: true },
  })
  const namedStudent = await prisma.user.findUnique({
    where: { regno: 'STU003' },
    select: { id: true },
  })

  if (broadcaster) {
    await prisma.notification.deleteMany({ where: { collegeId: COLLEGE_ID } })

    const announcements: {
      title: string
      body: string
      priority: string
      expiresInDays: number | null
      targetRole: string | null
      targetUserIds?: string[]
    }[] = [
      {
        title: 'End-semester examinations begin 24 September',
        body: 'Hall tickets are now available at the examination office. Report 30 minutes before each paper with your identity card. No electronic devices are permitted inside the hall.',
        priority: 'URGENT',
        expiresInDays: 21,
        targetRole: 'STUDENT',
      },
      {
        title: 'Library closed this weekend for annual stock-taking',
        body: 'The central library will remain closed on Saturday and Sunday. All due dates falling on those two days are automatically extended by 48 hours — no fine will accrue.',
        priority: 'NORMAL',
        expiresInDays: null,
        targetRole: null,
      },
      {
        title: 'Fee payment portal maintenance window',
        body: 'The online fee portal will be unavailable between 02:00 and 04:00 next Tuesday while we migrate to the new payment gateway.',
        priority: 'LOW',
        expiresInDays: 14,
        targetRole: null,
      },
      {
        // Lapsed on purpose: proves the banner auto-hides rather than relying
        // on anyone deleting old rows.
        title: 'Orientation programme — reporting time changed',
        body: 'First-year students should report to the main auditorium at 09:00 instead of 10:00.',
        priority: 'NORMAL',
        expiresInDays: -2,
        targetRole: 'STUDENT',
      },
      {
        title: 'Reminder: submit your scholarship renewal form',
        body: 'Your merit scholarship renewal is pending. Please submit the signed form to the student welfare office before the deadline or the waiver will lapse.',
        priority: 'URGENT',
        expiresInDays: 10,
        targetRole: null,
        targetUserIds: namedStudent ? [namedStudent.id] : [],
      },
    ]

    for (const spec of announcements) {
      await prisma.notification.create({
        data: {
          collegeId: COLLEGE_ID,
          createdByUserId: broadcaster.id,
          title: spec.title,
          body: spec.body,
          priority: spec.priority,
          expiresAt:
            spec.expiresInDays === null
              ? null
              : new Date(seedNow.getTime() + spec.expiresInDays * 86_400_000),
          targetRole: spec.targetRole,
          createdAt: daysAgo(1),
          ...(spec.targetUserIds?.length
            ? { targets: { create: spec.targetUserIds.map((userId) => ({ userId })) } }
            : {}),
        },
      })
    }
  }

  // ── Phase 4: Employees ───────────────────────────────────────────────────
  // Every non-student, non-parent account gets an employee record so the HR
  // register and the leave workflow have real people to act on.
  const STAFF_SPECS: {
    regno: string
    designation: string
    salaryBand: string
    joinedDaysAgo: number
    departmentId?: string
  }[] = [
    { regno: 'TCH001', designation: 'Assistant Professor', salaryBand: 'L6', joinedDaysAgo: 1460 },
    { regno: 'TCH002', designation: 'Associate Professor', salaryBand: 'L8', joinedDaysAgo: 2190 },
    { regno: 'TCH003', designation: 'Professor', salaryBand: 'L10', joinedDaysAgo: 3700 },
    { regno: 'HOD001', designation: 'Head of Department', salaryBand: 'L11', joinedDaysAgo: 4100 },
    { regno: 'HR001', designation: 'HR Manager', salaryBand: 'L7', joinedDaysAgo: 1100 },
    { regno: 'REG001', designation: 'Registrar', salaryBand: 'L9', joinedDaysAgo: 2900 },
    { regno: 'FIN001', designation: 'Finance Officer', salaryBand: 'L6', joinedDaysAgo: 980 },
    { regno: 'LIB001', designation: 'Chief Librarian', salaryBand: 'L6', joinedDaysAgo: 1500 },
    { regno: 'WDN001', designation: 'Hostel Warden', salaryBand: 'L5', joinedDaysAgo: 730 },
    { regno: 'PLA001', designation: 'Placement Officer', salaryBand: 'L7', joinedDaysAgo: 640 },
    // Electronics & Communication — the department HOD001 does *not* head.
    {
      regno: 'TCH004',
      designation: 'Assistant Professor',
      salaryBand: 'L6',
      joinedDaysAgo: 1250,
      departmentId: OTHER_DEPARTMENT_ID,
    },
    {
      regno: 'HOD002',
      designation: 'Head of Department',
      salaryBand: 'L11',
      joinedDaysAgo: 3300,
      departmentId: OTHER_DEPARTMENT_ID,
    },
  ]

  await prisma.employee.deleteMany({ where: { collegeId: COLLEGE_ID } })
  const employeeIds = new Map<string, string>()

  for (const spec of STAFF_SPECS) {
    const user = await prisma.user.findUnique({ where: { regno: spec.regno }, select: { id: true } })
    if (!user) continue
    const employee = await prisma.employee.upsert({
      where: { userId: user.id },
      update: {
        designation: spec.designation,
        salaryBand: spec.salaryBand,
        departmentId: spec.departmentId ?? DEPARTMENT_ID,
      },
      create: {
        collegeId: COLLEGE_ID,
        userId: user.id,
        designation: spec.designation,
        departmentId: spec.departmentId ?? DEPARTMENT_ID,
        salaryBand: spec.salaryBand,
        joinedAt: daysAgo(spec.joinedDaysAgo),
      },
    })
    employeeIds.set(spec.regno, employee.id)
  }

  // ── Phase 4: Leave requests ──────────────────────────────────────────────
  await prisma.leaveRequest.deleteMany({ where: { collegeId: COLLEGE_ID } })
  const LEAVE_SPECS: { regno: string; start: number; end: number; reason: string; status: string }[] = [
    { regno: 'TCH001', start: -3, end: 2, reason: 'Attending an international conference on distributed systems', status: 'PENDING' },
    { regno: 'TCH002', start: 5, end: 9, reason: 'Annual leave — family function out of station', status: 'PENDING' },
    { regno: 'TCH003', start: 14, end: 16, reason: 'Medical appointment and follow-up', status: 'PENDING' },
    { regno: 'LIB001', start: 1, end: 3, reason: 'Personal work', status: 'APPROVED' },
    { regno: 'FIN001', start: -20, end: -18, reason: 'Casual leave', status: 'REJECTED' },
    // Filed by ECM staff. HOD001 (CSE) must be refused on this one even though
    // they hold leave.approve — that refusal is the Tier-3 department scope.
    {
      regno: 'TCH004',
      start: 2,
      end: 6,
      reason: 'Conference travel — presenting a paper at ICEPT',
      status: 'PENDING',
    },
  ]

  for (const spec of LEAVE_SPECS) {
    const employeeId = employeeIds.get(spec.regno)
    if (!employeeId) continue
    await prisma.leaveRequest.create({
      data: {
        collegeId: COLLEGE_ID,
        employeeId,
        startDate: daysAgo(-spec.start),
        endDate: daysAgo(-spec.end),
        reason: spec.reason,
        status: spec.status,
        reviewedAt: spec.status === 'PENDING' ? null : daysAgo(Math.max(1, -spec.start + 1)),
      },
    })
  }

  // ── Phase 4: Placement ───────────────────────────────────────────────────
  await prisma.placementApplication.deleteMany({ where: { collegeId: COLLEGE_ID } })
  await prisma.placementDrive.deleteMany({ where: { collegeId: COLLEGE_ID } })

  const DRIVE_SPECS: {
    company: string
    role: string
    criteria: string
    inDays: number
    package: string
    /** Rendered to a PDF by /api/placements/drives/[id]/jd. */
    jd: string
    applicants: { regno: string; status: string }[]
  }[] = [
    {
      company: 'Northwind Analytics',
      role: 'Data Engineer',
      criteria: 'CGPA ≥ 7.0 · no active backlogs',
      inDays: 12,
      package: '₹12.5 LPA',
      jd: [
        'You will build and operate the batch and streaming pipelines that feed Northwind\'s',
        'analytics products, working alongside analysts and product engineers.',
        '',
        'Responsibilities',
        '· Design, build and maintain ETL/ELT pipelines over event and relational sources.',
        '· Own data quality: schema contracts, freshness SLAs and alerting on drift.',
        '· Model warehouse tables and keep them documented and discoverable.',
        '· Partner with analysts to turn ad-hoc questions into durable datasets.',
        '',
        'Requirements',
        '· Strong SQL and one of Python, Scala or Java.',
        '· Understanding of partitioning, incremental loads and idempotent reprocessing.',
        '· Exposure to a distributed engine (Spark, Flink or similar) through coursework or',
        '  a project. We do not expect production experience.',
        '',
        'Selection process',
        'Online assessment (90 minutes) · two technical interviews · one culture interview.',
        'Offers are released within five working days of the final round.',
      ].join('\n'),
      applicants: [
        { regno: 'STU001', status: 'SHORTLISTED' },
        { regno: 'STU002', status: 'APPLIED' },
        { regno: 'STU003', status: 'APPLIED' },
      ],
    },
    {
      company: 'Cobalt Systems',
      role: 'Software Engineer',
      criteria: 'CGPA ≥ 6.5 · final year',
      inDays: 26,
      package: '₹9.8 LPA',
      jd: [
        'Cobalt builds developer tooling used by engineering teams to ship safely. You will',
        'join a product team and own features end to end, from design through to on-call.',
        '',
        'What you will do',
        '· Ship user-facing features across a TypeScript and Go stack.',
        '· Write the tests that let the team deploy several times a day.',
        '· Take part in design review and code review from your first week.',
        '· Carry a share of on-call after a structured ramp-up.',
        '',
        'What we look for',
        '· Comfort with at least one general-purpose language and a willingness to learn ours.',
        '· Evidence of finishing something — a project, an internship, an open-source patch.',
        '· Clear written communication: most of our design work happens in writing.',
        '',
        'Notes',
        'The role is based in Bengaluru with a hybrid pattern of three days in office.',
        'A six-month structured mentorship runs for every new graduate.',
      ].join('\n'),
      applicants: [
        { regno: 'STU001', status: 'APPLIED' },
        { regno: 'STU004', status: 'APPLIED' },
        { regno: 'STU005', status: 'REJECTED' },
      ],
    },
    {
      company: 'Meridian Bank',
      role: 'Technology Analyst',
      criteria: 'CGPA ≥ 6.0 · all branches',
      inDays: -8,
      package: '₹7.2 LPA',
      jd: [
        'The Technology Analyst programme rotates you through two teams in your first year,',
        'covering core banking platforms and the digital channels that sit in front of them.',
        '',
        'Programme structure',
        '· Months 1–3: structured training on the bank\'s platform and secure coding practice.',
        '· Months 4–9: first rotation, typically core banking or payments.',
        '· Months 10–12: second rotation, typically digital channels or data.',
        '',
        'Eligibility',
        'Open to all branches. A background in financial systems is helpful but not required.',
        '',
        'Please note',
        'This drive has closed. Applications received before the closing date are still being',
        'processed and candidates will be contacted individually.',
      ].join('\n'),
      applicants: [
        { regno: 'STU002', status: 'SELECTED' },
        { regno: 'STU003', status: 'SHORTLISTED' },
        { regno: 'STU005', status: 'APPLIED' },
      ],
    },
    {
      // Deliberately left without STU001 so the student portal has a drive
      // that is both open and actionable — otherwise every Apply path in the
      // UI is hidden behind an existing application and never gets exercised.
      company: 'Kestrel Robotics',
      role: 'Embedded Systems Intern',
      criteria: 'CGPA ≥ 7.5 · ECE/CSE · 2027 batch',
      inDays: 34,
      package: '₹8.4 LPA',
      jd: [
        'Kestrel designs autonomous ground vehicles for warehouse logistics. Interns work on',
        'the firmware and perception stack that runs on the vehicle itself.',
        '',
        'Scope of the internship',
        '· Bring up and debug sensor drivers on an ARM Cortex-M target.',
        '· Profile a control loop and reduce jitter under real load.',
        '· Write host-side tooling to replay recorded runs in simulation.',
        '',
        'You should have',
        '· Comfort with C and reading a datasheet.',
        '· Some exposure to a microcontroller — a lab, a club project or a hobby build counts.',
        '· Interest in the constraints of embedded work: limited memory, hard deadlines.',
        '',
        'Duration and conversion',
        'Six months, with a strong preference for converting to a full-time offer at the end.',
      ].join('\n'),
      applicants: [
        { regno: 'STU002', status: 'APPLIED' },
        { regno: 'STU004', status: 'APPLIED' },
      ],
    },
    {
      // Proves the re-apply path end to end: STU001 withdrew from an OPEN drive,
      // so the portal must offer "Apply again" rather than locking them out.
      company: 'Halcyon Media',
      role: 'Product Analyst',
      criteria: 'CGPA ≥ 6.0 · any branch',
      inDays: 18,
      package: '₹8.0 LPA',
      jd: [
        'Halcyon runs subscription news products. As a Product Analyst you will be the person',
        'who answers "what actually happened when we shipped that?" with data.',
        '',
        'Responsibilities',
        '· Define and instrument the metrics behind a product decision.',
        '· Run experiments, and be the one who calls a result when it is inconclusive.',
        '· Build the dashboards that the product team lives in.',
        '',
        'Requirements',
        '· SQL, and enough statistics to know when a difference is noise.',
        '· Curiosity about why people behave the way they do.',
        '· Any branch is welcome — we have analysts from six different degrees.',
      ].join('\n'),
      applicants: [{ regno: 'STU001', status: 'WITHDRAWN' }],
    },
  ]

  for (const spec of DRIVE_SPECS) {
    const drive = await prisma.placementDrive.create({
      data: {
        collegeId: COLLEGE_ID,
        companyName: spec.company,
        role: spec.role,
        eligibilityCriteria: spec.criteria,
        driveDate: daysAgo(-spec.inDays),
        packageOffered: spec.package,
        jobDescription: spec.jd,
      },
    })
    for (const applicant of spec.applicants) {
      const student = await prisma.user.findUnique({
        where: { regno: applicant.regno },
        select: { id: true },
      })
      if (!student) continue
      await prisma.placementApplication.create({
        data: {
          collegeId: COLLEGE_ID,
          driveId: drive.id,
          studentId: student.id,
          status: applicant.status,
          createdAt: daysAgo(Math.max(1, -spec.inDays + 2)),
          // A withdrawn row carries the reason it was withdrawn, exactly as the
          // live withdrawal flow writes it — so the seeded state matches what
          // the application produces rather than looking like a different code
          // path made it.
          ...(applicant.status === 'WITHDRAWN'
            ? {
                withdrawReason: 'Accepted an internship offer that overlaps this drive.',
                withdrawnAt: daysAgo(3),
              }
            : {}),
        },
      })
    }
  }

  // ── Phase 4: Certificates ────────────────────────────────────────────────
  await prisma.certificate.deleteMany({ where: { collegeId: COLLEGE_ID } })
  const CERT_SPECS = [
    { regno: 'STU001', type: 'BONAFIDE', daysAgoIssued: 40 },
    { regno: 'STU002', type: 'BONAFIDE', daysAgoIssued: 22 },
    { regno: 'STU003', type: 'TRANSCRIPT', daysAgoIssued: 9 },
  ]
  for (const spec of CERT_SPECS) {
    const student = await prisma.user.findUnique({ where: { regno: spec.regno }, select: { id: true } })
    if (!student) continue
    await prisma.certificate.create({
      data: {
        collegeId: COLLEGE_ID,
        studentId: student.id,
        type: spec.type,
        issuedAt: daysAgo(spec.daysAgoIssued),
        fileUrl: `/certificates/${spec.regno}-${spec.type.toLowerCase()}.pdf`,
      },
    })
  }

  // ── Phase 4: Parent ↔ child links ────────────────────────────────────────
  // Mohan Menon (PAR001) is Kabir Menon's (STU003) guardian. Stored as a fact
  // rather than inferred from a shared surname.
  await prisma.parentChild.deleteMany({ where: { collegeId: COLLEGE_ID } })
  const parentUser = await prisma.user.findUnique({ where: { regno: 'PAR001' }, select: { id: true } })
  const childUser = await prisma.user.findUnique({ where: { regno: 'STU003' }, select: { id: true } })
  if (parentUser && childUser) {
    await prisma.parentChild.create({
      data: {
        collegeId: COLLEGE_ID,
        parentId: parentUser.id,
        studentId: childUser.id,
        relation: 'FATHER',
      },
    })
  }

  // ── Admissions ──────────────────────────────────────────────────────────
  // One row per stage of the funnel so the admissions screen has something to
  // filter on and every branch (decide / reject / convert) is exercisable.
  await prisma.admission.deleteMany({ where: { collegeId: COLLEGE_ID } })
  const admissionOfficer = await prisma.user.findUnique({
    where: { regno: 'ADM001' },
    select: { id: true },
  })
  const ADMISSION_SPECS = [
    {
      applicantName: 'Ishaan Verma',
      email: 'ishaan.verma@applicant.apex.edu',
      phone: '+91 98100 11223',
      programAppliedFor: 'B.Tech Computer Science',
      meritScore: 91.4,
      status: 'PENDING',
      daysAgoApplied: 3,
    },
    {
      applicantName: 'Diya Krishnan',
      email: 'diya.krishnan@applicant.apex.edu',
      phone: '+91 98100 44556',
      programAppliedFor: 'B.Tech Electronics',
      meritScore: 88.2,
      status: 'PENDING',
      daysAgoApplied: 5,
    },
    {
      applicantName: 'Arjun Rao',
      email: 'arjun.rao@applicant.apex.edu',
      phone: '+91 98100 77889',
      programAppliedFor: 'B.Tech Mechanical',
      meritScore: 74.6,
      status: 'PENDING',
      daysAgoApplied: 6,
    },
    {
      applicantName: 'Sneha Iyer',
      email: 'sneha.iyer@applicant.apex.edu',
      phone: '+91 98100 22334',
      programAppliedFor: 'B.Tech Computer Science',
      meritScore: 93.1,
      status: 'APPROVED',
      daysAgoApplied: 12,
    },
    {
      applicantName: 'Rohan Gupta',
      email: 'rohan.gupta@applicant.apex.edu',
      phone: '+91 98100 55667',
      programAppliedFor: 'B.Tech Civil',
      meritScore: 61.8,
      status: 'REJECTED',
      daysAgoApplied: 14,
    },
    // Terminal state: already turned into a real student account (STU005).
    {
      applicantName: 'Kabir Menon',
      email: 'kabir.menon@applicant.apex.edu',
      phone: '+91 98100 99001',
      programAppliedFor: 'B.Tech Computer Science',
      meritScore: 89.7,
      status: 'CONVERTED',
      daysAgoApplied: 40,
      convertedToRegno: 'STU005',
    },
  ]

  for (const spec of ADMISSION_SPECS) {
    const convertedTo = spec.convertedToRegno
      ? await prisma.user.findUnique({
          where: { regno: spec.convertedToRegno },
          select: { id: true },
        })
      : null
    await prisma.admission.create({
      data: {
        collegeId: COLLEGE_ID,
        applicantName: spec.applicantName,
        email: spec.email,
        phone: spec.phone,
        programAppliedFor: spec.programAppliedFor,
        documentsUrl: `/admissions/${spec.email.split('@')[0]}.pdf`,
        meritScore: spec.meritScore,
        status: spec.status,
        convertedToUserId: convertedTo?.id ?? null,
        convertedByUserId: spec.status === 'CONVERTED' ? admissionOfficer?.id ?? null : null,
        createdAt: daysAgo(spec.daysAgoApplied),
      },
    })
  }

  // ── Semesters ────────────────────────────────────────────────────────────
  // Real records with ids: results are filtered by semester id, so renumbering
  // can never orphan a student's history.
  await prisma.semester.deleteMany({ where: { collegeId: COLLEGE_ID } })
  const SEMESTER_SPECS = [
    { number: 1, name: 'Semester 1', isCurrent: false },
    { number: 2, name: 'Semester 2', isCurrent: false },
    { number: 3, name: 'Semester 3', isCurrent: false },
    { number: 4, name: 'Semester 4', isCurrent: false },
    { number: 5, name: 'Semester 5', isCurrent: false },
  ]
  const semesters = new Map<number, string>()
  for (const spec of SEMESTER_SPECS) {
    const row = await prisma.semester.create({
      data: { collegeId: COLLEGE_ID, ...spec },
      select: { id: true, number: true },
    })
    semesters.set(row.number, row.id)
  }

  // Point each section at its semester record…
  const allClasses = await prisma.class.findMany({
    where: { collegeId: COLLEGE_ID },
    select: { id: true, semester: true },
  })
  for (const klass of allClasses) {
    await prisma.class.update({
      where: { id: klass.id },
      data: { semesterId: semesters.get(klass.semester) ?? null },
    })
  }

  // "Current" is derived, never hardcoded — it is whichever semester holds the
  // most students, so the results page defaults to where the cohort actually is.
  const busiest = await prisma.class.findFirst({
    where: { collegeId: COLLEGE_ID },
    orderBy: { students: { _count: 'desc' } },
    select: { semesterId: true },
  })
  if (busiest?.semesterId) {
    await prisma.semester.updateMany({
      where: { collegeId: COLLEGE_ID },
      data: { isCurrent: false },
    })
    await prisma.semester.update({
      where: { id: busiest.semesterId },
      data: { isCurrent: true },
    })
  }

  // …and every exam too, so results can be grouped by semester.
  const allExams = await prisma.exam.findMany({
    where: { collegeId: COLLEGE_ID },
    select: { id: true, courseId: true },
  })
  const courseToSemester = new Map<string, string | null>()
  const enrollmentsForCourses = await prisma.courseEnrollment.findMany({
    where: { collegeId: COLLEGE_ID },
    select: { courseId: true, class: { select: { semester: true } } },
  })
  for (const e of enrollmentsForCourses) {
    if (courseToSemester.has(e.courseId)) continue
    courseToSemester.set(e.courseId, semesters.get(e.class?.semester ?? 4) ?? null)
  }

  /**
   * Explicit semester per seeded course, which wins over the derived value.
   *
   * The derivation below reads a course's semester off whichever section is
   * enrolled first — non-deterministic once a course is shared, and plainly
   * wrong for CS301/CS302: those are *past* courses, but their enrollments sit
   * in a current section, so the derived answer would file them under the
   * present semester and flatten the transcript back to one row.
   */
  const COURSE_SEMESTER: Record<string, number> = {
    CS301: 3,
    CS302: 3,
    CS501: 5,
    CS502: 5,
    CS503: 5,
  }
  const courseCodeRows = await prisma.course.findMany({
    where: { collegeId: COLLEGE_ID },
    select: { id: true, code: true },
  })
  const codeByCourseId = new Map(courseCodeRows.map((c) => [c.id, c.code]))

  for (const exam of allExams) {
    const code = codeByCourseId.get(exam.courseId)
    const explicit = code ? COURSE_SEMESTER[code] : undefined
    const target =
      explicit !== undefined
        ? semesters.get(explicit) ?? null
        : courseToSemester.get(exam.courseId) ?? semesters.get(4) ?? null
    await prisma.exam.update({
      where: { id: exam.id },
      data: { semesterId: target },
    })
  }

  // ── Hostel leave ─────────────────────────────────────────────────────────
  // One approved and one pending, so both the list and the slip are visible
  // without submitting anything first.
  await prisma.hostelLeave.deleteMany({ where: { collegeId: COLLEGE_ID } })
  const HOSTEL_LEAVE_SPECS = [
    {
      regno: 'STU001',
      fromDaysAgo: 20,
      nights: 3,
      reason: 'Family wedding in Pune. Contact number unchanged.',
      status: 'APPROVED',
      decidedDaysAgo: 19,
    },
    {
      regno: 'STU002',
      fromDaysAgo: -6,
      nights: 2,
      reason: 'Sister’s convocation at IIT Madras.',
      status: 'PENDING',
    },
  ]
  const wardenUser = await prisma.user.findUnique({
    where: { regno: 'WDN001' },
    select: { id: true },
  })
  for (const spec of HOSTEL_LEAVE_SPECS) {
    const student = await prisma.user.findUnique({
      where: { regno: spec.regno },
      select: { id: true },
    })
    if (!student) continue
    const from = daysAgo(spec.fromDaysAgo)
    const to = new Date(from.getTime() + spec.nights * 24 * 60 * 60 * 1000)
    const decided =
      'decidedDaysAgo' in spec && typeof spec.decidedDaysAgo === 'number'
        ? daysAgo(spec.decidedDaysAgo)
        : null
    await prisma.hostelLeave.create({
      data: {
        collegeId: COLLEGE_ID,
        studentId: student.id,
        fromDate: from,
        toDate: to,
        reason: spec.reason,
        status: spec.status,
        decidedByUserId: decided ? wardenUser?.id ?? null : null,
        decidedAt: decided,
        createdAt: daysAgo(spec.fromDaysAgo > 0 ? spec.fromDaysAgo + 4 : 1),
      },
    })
  }

  // ── Student sections & roll numbers ──────────────────────────────────────
  // A student belongs to one home section and carries a roll number that is
  // unique *within* that section — so roll 1 exists in every section. This is
  // what a teacher sees on the attendance roll alongside the regno.
  const studentUsers = await prisma.user.findMany({
    where: { collegeId: COLLEGE_ID, role: 'STUDENT' },
    select: { id: true, regno: true },
    orderBy: { regno: 'asc' },
  })
  const sectionRows = await prisma.class.findMany({
    where: { collegeId: COLLEGE_ID },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  if (sectionRows.length > 0) {
    const counters = new Map<string, number>()
    for (const [index, student] of studentUsers.entries()) {
      const section = sectionRows[index % sectionRows.length]
      const next = (counters.get(section.id) ?? 0) + 1
      counters.set(section.id, next)
      await prisma.user.update({
        where: { id: student.id },
        data: { classId: section.id, rollNo: String(next).padStart(2, '0') },
      })
    }
  }

  // ── Academic calendar ────────────────────────────────────────────────────
  // Non-teaching days. Deliberately a mix of college-wide and section-only so
  // the calendar's "Whole college" / "Your section only" subtitle has both
  // cases covered on a fresh database.
  await prisma.academicCalendarDay.deleteMany({ where: { collegeId: COLLEGE_ID } })
  const adminUser = await prisma.user.findFirst({
    where: { collegeId: COLLEGE_ID, role: 'ADMIN' },
    select: { id: true },
  })
  const firstSection = sectionRows[0]?.id ?? null

  const CALENDAR_SPECS: {
    inDays: number
    title: string
    kind: string
    sectionOnly?: boolean
  }[] = [
    { inDays: -21, title: 'Founders’ Day', kind: 'HOLIDAY' },
    { inDays: -9, title: 'Mid-semester break', kind: 'BREAK' },
    { inDays: 4, title: 'Institute Day', kind: 'EVENT' },
    { inDays: 11, title: 'Public holiday — festival', kind: 'HOLIDAY' },
    { inDays: 15, title: 'Local body election', kind: 'CLOSURE' },
    { inDays: 6, title: 'Section industrial visit', kind: 'EVENT', sectionOnly: true },
    { inDays: 23, title: 'Semester-end examinations begin', kind: 'EVENT' },
  ]

  if (adminUser) {
    // A day offset relative to *today*, but at UTC midnight — a holiday is a
    // date, not an instant, and the calendar compares date keys.
    const todayMidnight = new Date()
    todayMidnight.setUTCHours(0, 0, 0, 0)
    for (const spec of CALENDAR_SPECS) {
      const date = new Date(todayMidnight.getTime() + spec.inDays * 86_400_000)
      await prisma.academicCalendarDay.create({
        data: {
          collegeId: COLLEGE_ID,
          date,
          title: spec.title,
          kind: spec.kind,
          classId: spec.sectionOnly ? firstSection : null,
          createdByUserId: adminUser.id,
        },
      })
    }
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
