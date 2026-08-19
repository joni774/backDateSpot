-- CreateTable
CREATE TABLE "AiSecurityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "layer" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rawMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSecurityLog_pkey" PRIMARY KEY ("id")
);
