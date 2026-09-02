-- Remove Ten Bis / Mishloha delivery support; keep Wolt only.
-- Historical DELIVERY_TENBIS / DELIVERY_MISHLOHA leads are deleted (enum values cannot be dropped otherwise).

DELETE FROM "PlaceLead" WHERE "type" IN ('DELIVERY_TENBIS', 'DELIVERY_MISHLOHA');

ALTER TABLE "Place" DROP COLUMN IF EXISTS "deliveryTenBisUrl";
ALTER TABLE "Place" DROP COLUMN IF EXISTS "deliveryMishlohaUrl";

CREATE TYPE "LeadType_new" AS ENUM ('CALL', 'WHATSAPP', 'WEBSITE', 'DELIVERY_WOLT');

ALTER TABLE "PlaceLead"
  ALTER COLUMN "type" TYPE "LeadType_new"
  USING ("type"::text::"LeadType_new");

DROP TYPE "LeadType";

ALTER TYPE "LeadType_new" RENAME TO "LeadType";
