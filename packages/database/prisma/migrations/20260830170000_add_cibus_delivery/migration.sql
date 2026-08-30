-- Add Cibus as a delivery provider. Written idempotently (IF NOT EXISTS) so it is
-- safe to apply regardless of whether this environment already has the Wolt/Ten Bis/
-- Mishloha columns and enum values from earlier migrations.

ALTER TYPE "LeadType" ADD VALUE IF NOT EXISTS 'DELIVERY_WOLT';
ALTER TYPE "LeadType" ADD VALUE IF NOT EXISTS 'DELIVERY_TENBIS';
ALTER TYPE "LeadType" ADD VALUE IF NOT EXISTS 'DELIVERY_MISHLOHA';
ALTER TYPE "LeadType" ADD VALUE IF NOT EXISTS 'DELIVERY_CIBUS';

ALTER TABLE "Place" ADD COLUMN IF NOT EXISTS "deliveryTenBisUrl" TEXT;
ALTER TABLE "Place" ADD COLUMN IF NOT EXISTS "deliveryMishlohaUrl" TEXT;
ALTER TABLE "Place" ADD COLUMN IF NOT EXISTS "deliveryCibusUrl" TEXT;
