-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentActionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collegeId" TEXT,
    "agentName" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetEntity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedByUserId" TEXT,
    "details" TEXT NOT NULL,
    "hash" TEXT,
    "prevHash" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentActionLog_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentActionLog_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AgentActionLog" ("actionType", "agentName", "approvedByUserId", "collegeId", "createdAt", "details", "hash", "id", "prevHash", "status", "targetEntity", "timestamp", "updatedAt") SELECT "actionType", "agentName", "approvedByUserId", "collegeId", "createdAt", "details", "hash", "id", "prevHash", "status", "targetEntity", "timestamp", "updatedAt" FROM "AgentActionLog";
DROP TABLE "AgentActionLog";
ALTER TABLE "new_AgentActionLog" RENAME TO "AgentActionLog";
CREATE INDEX "AgentActionLog_collegeId_idx" ON "AgentActionLog"("collegeId");
CREATE INDEX "AgentActionLog_timestamp_idx" ON "AgentActionLog"("timestamp");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
