-- AlterTable
ALTER TABLE "Place" ADD COLUMN "deliveryWoltUrl" TEXT,
ADD COLUMN "deliveryTenBisUrl" TEXT,
ADD COLUMN "deliveryMishlohaUrl" TEXT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "provider" TEXT NOT NULL DEFAULT 'card',
    "status" TEXT NOT NULL DEFAULT 'succeeded',
    "last4" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
