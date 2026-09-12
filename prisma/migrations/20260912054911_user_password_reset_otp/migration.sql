-- AlterTable
ALTER TABLE "User" ADD COLUMN "otpExpiry" DATETIME;
ALTER TABLE "User" ADD COLUMN "resetOtp" TEXT;
