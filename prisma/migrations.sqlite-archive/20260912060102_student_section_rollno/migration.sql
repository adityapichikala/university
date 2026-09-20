-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "regno" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "collegeId" TEXT,
    "departmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "classId" TEXT,
    "rollNo" TEXT,
    "resetOtp" TEXT,
    "otpExpiry" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("collegeId", "createdAt", "departmentId", "email", "id", "name", "otpExpiry", "passwordHash", "regno", "resetOtp", "role", "status", "updatedAt") SELECT "collegeId", "createdAt", "departmentId", "email", "id", "name", "otpExpiry", "passwordHash", "regno", "resetOtp", "role", "status", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_regno_key" ON "User"("regno");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_collegeId_idx" ON "User"("collegeId");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_classId_idx" ON "User"("classId");
CREATE UNIQUE INDEX "User_classId_rollNo_key" ON "User"("classId", "rollNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
