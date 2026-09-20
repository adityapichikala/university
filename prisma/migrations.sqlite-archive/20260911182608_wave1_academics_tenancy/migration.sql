-- Wave 1: make course codes and class names tenant-scoped (Option A tenancy §4.2).
-- A global unique on `code` would stop two colleges from both running "CS101".

-- DropIndex
DROP INDEX "Course_code_key";

-- CreateIndex
CREATE UNIQUE INDEX "Class_collegeId_name_key" ON "Class"("collegeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Course_collegeId_code_key" ON "Course"("collegeId", "code");
