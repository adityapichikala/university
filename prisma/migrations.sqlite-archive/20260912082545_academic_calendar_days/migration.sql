-- CreateTable
CREATE TABLE "AcademicCalendarDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collegeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'HOLIDAY',
    "classId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcademicCalendarDay_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AcademicCalendarDay_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AcademicCalendarDay_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AcademicCalendarDay_collegeId_date_idx" ON "AcademicCalendarDay"("collegeId", "date");

-- CreateIndex
CREATE INDEX "AcademicCalendarDay_classId_idx" ON "AcademicCalendarDay"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicCalendarDay_collegeId_date_classId_key" ON "AcademicCalendarDay"("collegeId", "date", "classId");

-- CreateIndex
CREATE INDEX "Exam_examDate_idx" ON "Exam"("examDate");
