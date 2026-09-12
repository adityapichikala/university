-- AlterTable
ALTER TABLE "PlacementApplication" ADD COLUMN "withdrawReason" TEXT;
ALTER TABLE "PlacementApplication" ADD COLUMN "withdrawnAt" DATETIME;

-- AlterTable
ALTER TABLE "PlacementDrive" ADD COLUMN "jobDescription" TEXT;

-- CreateIndex
CREATE INDEX "PlacementApplication_status_idx" ON "PlacementApplication"("status");

-- CreateIndex
CREATE INDEX "PlacementDrive_driveDate_idx" ON "PlacementDrive"("driveDate");
