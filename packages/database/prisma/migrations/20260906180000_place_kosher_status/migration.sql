-- CreateEnum
CREATE TYPE "KosherStatus" AS ENUM ('UNKNOWN', 'NONE', 'PARTIAL', 'STRICT');

-- AlterTable
ALTER TABLE "Place" ADD COLUMN "kosherStatus" "KosherStatus" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Place" ADD COLUMN "kosherCertification" TEXT;
