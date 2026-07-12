-- Nearby people feature: age verification, visibility, interests, blocks, reports.

ALTER TABLE "User" ADD COLUMN "ageVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "isVisibleNearby" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "nearbyLat" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "nearbyLng" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "nearbyUpdatedAt" TIMESTAMP(3);

CREATE TABLE "NearbyInterest" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NearbyInterest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NearbyBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NearbyBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NearbyReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NearbyReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NearbyInterest_fromUserId_toUserId_key" ON "NearbyInterest"("fromUserId", "toUserId");
CREATE UNIQUE INDEX "NearbyBlock_blockerId_blockedId_key" ON "NearbyBlock"("blockerId", "blockedId");

ALTER TABLE "NearbyInterest" ADD CONSTRAINT "NearbyInterest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NearbyInterest" ADD CONSTRAINT "NearbyInterest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NearbyBlock" ADD CONSTRAINT "NearbyBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NearbyBlock" ADD CONSTRAINT "NearbyBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
