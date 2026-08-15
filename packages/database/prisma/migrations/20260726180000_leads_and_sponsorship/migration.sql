-- CreateEnum
CREATE TYPE "LeadType" AS ENUM ('CALL', 'WHATSAPP', 'WEBSITE');

-- AlterTable
ALTER TABLE "Place" ADD COLUMN "leadFeeAgorot" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "sponsoredUntil" TIMESTAMP(3),
ADD COLUMN "sponsoredPriority" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PlaceLead" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LeadType" NOT NULL,
    "feeAgorot" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Place_sponsoredUntil_idx" ON "Place"("sponsoredUntil");

-- CreateIndex
CREATE INDEX "PlaceLead_placeId_createdAt_idx" ON "PlaceLead"("placeId", "createdAt");

-- CreateIndex
CREATE INDEX "PlaceLead_userId_idx" ON "PlaceLead"("userId");

-- CreateIndex
CREATE INDEX "PlaceLead_createdAt_idx" ON "PlaceLead"("createdAt");

-- AddForeignKey
ALTER TABLE "PlaceLead" ADD CONSTRAINT "PlaceLead_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceLead" ADD CONSTRAINT "PlaceLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
