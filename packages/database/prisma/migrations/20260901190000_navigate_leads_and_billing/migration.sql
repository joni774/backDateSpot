-- NAVIGATE lead type for map/directions intent.
ALTER TYPE "LeadType" ADD VALUE IF NOT EXISTS 'NAVIGATE';

-- Stripe lead invoice lifecycle.
CREATE TYPE "LeadInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'FAILED');

-- Business billing fields on places.
ALTER TABLE "Place" ADD COLUMN IF NOT EXISTS "billingEmail" TEXT;
ALTER TABLE "Place" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "Place" ADD COLUMN IF NOT EXISTS "leadBillingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Invoice batches for unbilled leads.
CREATE TABLE IF NOT EXISTS "LeadInvoice" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT,
    "status" "LeadInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAgorot" INTEGER NOT NULL,
    "leadCount" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadInvoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeadInvoice_placeId_createdAt_idx" ON "LeadInvoice"("placeId", "createdAt");
CREATE INDEX IF NOT EXISTS "LeadInvoice_status_idx" ON "LeadInvoice"("status");

ALTER TABLE "LeadInvoice" DROP CONSTRAINT IF EXISTS "LeadInvoice_placeId_fkey";
ALTER TABLE "LeadInvoice" ADD CONSTRAINT "LeadInvoice_placeId_fkey"
  FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlaceLead" ADD COLUMN IF NOT EXISTS "leadInvoiceId" TEXT;

CREATE INDEX IF NOT EXISTS "PlaceLead_leadInvoiceId_idx" ON "PlaceLead"("leadInvoiceId");

ALTER TABLE "PlaceLead" DROP CONSTRAINT IF EXISTS "PlaceLead_leadInvoiceId_fkey";
ALTER TABLE "PlaceLead" ADD CONSTRAINT "PlaceLead_leadInvoiceId_fkey"
  FOREIGN KEY ("leadInvoiceId") REFERENCES "LeadInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
