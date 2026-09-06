-- Remove Cibus delivery + add per-provider availability statuses for Wolt / TenBis / Mishloha.

-- 1) Purge Cibus lead history and column
DELETE FROM "PlaceLead" WHERE "type"::text = 'DELIVERY_CIBUS';
ALTER TABLE "Place" DROP COLUMN IF EXISTS "deliveryCibusUrl";

-- 2) Recreate LeadType without DELIVERY_CIBUS (Postgres cannot drop enum values in-place)
CREATE TYPE "LeadType_new" AS ENUM (
  'CALL',
  'WHATSAPP',
  'WEBSITE',
  'NAVIGATE',
  'DELIVERY_WOLT',
  'DELIVERY_TENBIS',
  'DELIVERY_MISHLOHA'
);

ALTER TABLE "PlaceLead"
  ALTER COLUMN "type" TYPE "LeadType_new"
  USING ("type"::text::"LeadType_new");

DROP TYPE "LeadType";
ALTER TYPE "LeadType_new" RENAME TO "LeadType";

-- 3) Delivery availability enum + columns
CREATE TYPE "DeliveryAvailability" AS ENUM ('UNKNOWN', 'AVAILABLE', 'NOT_AVAILABLE');

ALTER TABLE "Place"
  ADD COLUMN IF NOT EXISTS "deliveryWoltStatus" "DeliveryAvailability" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "deliveryTenBisStatus" "DeliveryAvailability" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "deliveryMishlohaStatus" "DeliveryAvailability" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "deliveryStatusCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveryStatusConfirmedByAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing hand-entered URLs count as AVAILABLE + already confirmed
UPDATE "Place"
SET
  "deliveryWoltStatus" = CASE
    WHEN "deliveryWoltUrl" IS NOT NULL AND TRIM("deliveryWoltUrl") <> '' THEN 'AVAILABLE'::"DeliveryAvailability"
    ELSE "deliveryWoltStatus"
  END,
  "deliveryTenBisStatus" = CASE
    WHEN "deliveryTenBisUrl" IS NOT NULL AND TRIM("deliveryTenBisUrl") <> '' THEN 'AVAILABLE'::"DeliveryAvailability"
    ELSE "deliveryTenBisStatus"
  END,
  "deliveryMishlohaStatus" = CASE
    WHEN "deliveryMishlohaUrl" IS NOT NULL AND TRIM("deliveryMishlohaUrl") <> '' THEN 'AVAILABLE'::"DeliveryAvailability"
    ELSE "deliveryMishlohaStatus"
  END,
  "deliveryStatusConfirmedByAdmin" = CASE
    WHEN
      ("deliveryWoltUrl" IS NOT NULL AND TRIM("deliveryWoltUrl") <> '')
      OR ("deliveryTenBisUrl" IS NOT NULL AND TRIM("deliveryTenBisUrl") <> '')
      OR ("deliveryMishlohaUrl" IS NOT NULL AND TRIM("deliveryMishlohaUrl") <> '')
    THEN true
    ELSE "deliveryStatusConfirmedByAdmin"
  END;
