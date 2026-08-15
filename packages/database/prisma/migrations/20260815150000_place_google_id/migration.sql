-- AlterTable
ALTER TABLE "Place" ADD COLUMN "googlePlaceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Place_googlePlaceId_key" ON "Place"("googlePlaceId");
