-- Governance: tamper-evident audit chain + section-level course access.

-- AlterTable
ALTER TABLE "AgentActionLog" ADD COLUMN "hash" TEXT;
ALTER TABLE "AgentActionLog" ADD COLUMN "prevHash" TEXT;

-- CreateTable
CREATE TABLE "CourseSectionAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collegeId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CourseSectionAccess_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseSectionAccess_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseSectionAccess_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CourseSectionAccess_collegeId_idx" ON "CourseSectionAccess"("collegeId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseSectionAccess_courseId_classId_key" ON "CourseSectionAccess"("courseId", "classId");
