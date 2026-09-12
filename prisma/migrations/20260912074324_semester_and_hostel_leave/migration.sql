-- CreateTable
CREATE TABLE "HostelLeave" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collegeId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromDate" DATETIME NOT NULL,
    "toDate" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedAt" DATETIME,
    "decisionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HostelLeave_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HostelLeave_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HostelLeave_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Semester" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collegeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Semester_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Class" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "semesterId" TEXT,
    "batchYear" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Class_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Class_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Class_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Class" ("batchYear", "collegeId", "createdAt", "departmentId", "id", "name", "semester", "updatedAt") SELECT "batchYear", "collegeId", "createdAt", "departmentId", "id", "name", "semester", "updatedAt" FROM "Class";
DROP TABLE "Class";
ALTER TABLE "new_Class" RENAME TO "Class";
CREATE INDEX "Class_collegeId_idx" ON "Class"("collegeId");
CREATE INDEX "Class_departmentId_idx" ON "Class"("departmentId");
CREATE INDEX "Class_semesterId_idx" ON "Class"("semesterId");
CREATE UNIQUE INDEX "Class_collegeId_name_key" ON "Class"("collegeId", "name");
CREATE TABLE "new_Exam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collegeId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "examDate" DATETIME NOT NULL,
    "examType" TEXT NOT NULL,
    "maxMarks" REAL NOT NULL,
    "semesterId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Exam_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Exam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Exam_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Exam" ("collegeId", "courseId", "createdAt", "examDate", "examType", "id", "maxMarks", "updatedAt") SELECT "collegeId", "courseId", "createdAt", "examDate", "examType", "id", "maxMarks", "updatedAt" FROM "Exam";
DROP TABLE "Exam";
ALTER TABLE "new_Exam" RENAME TO "Exam";
CREATE INDEX "Exam_collegeId_idx" ON "Exam"("collegeId");
CREATE INDEX "Exam_courseId_idx" ON "Exam"("courseId");
CREATE INDEX "Exam_semesterId_idx" ON "Exam"("semesterId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "HostelLeave_collegeId_idx" ON "HostelLeave"("collegeId");

-- CreateIndex
CREATE INDEX "HostelLeave_studentId_idx" ON "HostelLeave"("studentId");

-- CreateIndex
CREATE INDEX "HostelLeave_status_idx" ON "HostelLeave"("status");

-- CreateIndex
CREATE INDEX "Semester_collegeId_idx" ON "Semester"("collegeId");

-- CreateIndex
CREATE UNIQUE INDEX "Semester_collegeId_number_key" ON "Semester"("collegeId", "number");
