-- Re-add Ten Bis / Mishloha delivery support (previously removed) and add Cibus.
-- New enum values only add (cannot re-add old ones with the exact same identity, but the
-- names are equivalent and behave the same way going forward).

ALTER TYPE "LeadType" ADD VALUE 'DELIVERY_TENBIS';
ALTER TYPE "LeadType" ADD VALUE 'DELIVERY_MISHLOHA';
ALTER TYPE "LeadType" ADD VALUE 'DELIVERY_CIBUS';

ALTER TABLE "Place" ADD COLUMN "deliveryTenBisUrl" TEXT;
ALTER TABLE "Place" ADD COLUMN "deliveryMishlohaUrl" TEXT;
ALTER TABLE "Place" ADD COLUMN "deliveryCibusUrl" TEXT;
