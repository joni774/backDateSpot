import { prisma, PlaceCategory, PriceRange, type Place } from "@datespot/database";

const VALID_CATEGORIES = new Set<string>(Object.values(PlaceCategory));
const VALID_PRICE_RANGES = new Set<string>(Object.values(PriceRange));

type PlaceWhere = {
  isActive?: boolean;
  category?: PlaceCategory | { in: PlaceCategory[] };
  latitude?: { gte: number; lte: number };
  longitude?: { gte: number; lte: number };
};

function normalizeCategory(value: unknown): PlaceCategory {
  const raw = String(value ?? "");
  if (VALID_CATEGORIES.has(raw)) return raw as PlaceCategory;
  return PlaceCategory.RESTAURANT;
}

function normalizePriceRange(value: unknown): PriceRange {
  const raw = String(value ?? "");
  if (VALID_PRICE_RANGES.has(raw)) return raw as PriceRange;
  return PriceRange.MODERATE;
}

function mapRawPlaceRow(row: Record<string, unknown>): Place | null {
  const id = row.id;
  if (typeof id !== "string") return null;

  const openingHours =
    row.openingHours && typeof row.openingHours === "object"
      ? row.openingHours
      : {};

  const images = Array.isArray(row.images)
    ? row.images.filter((item): item is string => typeof item === "string")
    : [];

  return {
    id,
    nameHe: String(row.nameHe ?? ""),
    nameEn: String(row.nameEn ?? ""),
    nameAr: String(row.nameAr ?? ""),
    descriptionHe: String(row.descriptionHe ?? ""),
    descriptionEn: String(row.descriptionEn ?? ""),
    descriptionAr: String(row.descriptionAr ?? ""),
    category: normalizeCategory(row.category),
    latitude: Number(row.latitude ?? 0),
    longitude: Number(row.longitude ?? 0),
    address: String(row.address ?? ""),
    priceRange: normalizePriceRange(row.priceRange),
    images,
    openingHours,
    phone: row.phone == null ? null : String(row.phone),
    website: row.website == null ? null : String(row.website),
    deliveryWoltUrl: row.deliveryWoltUrl == null ? null : String(row.deliveryWoltUrl),
    deliveryTenBisUrl: row.deliveryTenBisUrl == null ? null : String(row.deliveryTenBisUrl),
    deliveryMishlohaUrl:
      row.deliveryMishlohaUrl == null ? null : String(row.deliveryMishlohaUrl),
    deliveryCibusUrl: row.deliveryCibusUrl == null ? null : String(row.deliveryCibusUrl),
    isActive: row.isActive !== false,
    displayOrder: Number(row.displayOrder ?? 0),
    viewCount: Number(row.viewCount ?? 0),
    leadFeeAgorot: Number(row.leadFeeAgorot ?? 0),
    billingEmail: row.billingEmail == null ? null : String(row.billingEmail),
    stripeCustomerId: row.stripeCustomerId == null ? null : String(row.stripeCustomerId),
    leadBillingEnabled: row.leadBillingEnabled === true,
    sponsoredUntil:
      row.sponsoredUntil instanceof Date
        ? row.sponsoredUntil
        : row.sponsoredUntil
          ? new Date(String(row.sponsoredUntil))
          : null,
    sponsoredPriority: Number(row.sponsoredPriority ?? 0),
    googlePlaceId: row.googlePlaceId == null ? null : String(row.googlePlaceId),
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt
        : new Date(String(row.createdAt ?? Date.now())),
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt
        : new Date(String(row.updatedAt ?? Date.now())),
  } as Place;
}

async function loadPlacesViaRaw(where: PlaceWhere, orderByDisplay = false): Promise<Place[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (where.isActive === false) {
    conditions.push('"isActive" = false');
  } else {
    conditions.push('"isActive" = true');
  }

  if (where.latitude && where.longitude) {
    params.push(where.latitude.gte);
    conditions.push(`"latitude" >= $${params.length}`);
    params.push(where.latitude.lte);
    conditions.push(`"latitude" <= $${params.length}`);
    params.push(where.longitude.gte);
    conditions.push(`"longitude" >= $${params.length}`);
    params.push(where.longitude.lte);
    conditions.push(`"longitude" <= $${params.length}`);
  }

  if (where.category && typeof where.category === "string") {
    params.push(where.category);
    conditions.push(`"category"::text = $${params.length}`);
  } else if (where.category && "in" in where.category) {
    const categories = where.category.in;
    if (categories.length > 0) {
      params.push(categories);
      conditions.push(`"category"::text = ANY($${params.length})`);
    }
  }

  const orderClause = orderByDisplay ? 'ORDER BY "displayOrder" ASC' : 'ORDER BY "id" ASC';
  const query = `SELECT * FROM "Place" WHERE ${conditions.join(" AND ")} ${orderClause}`;

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(query, ...params);
  return rows
    .map((row) => mapRawPlaceRow(row))
    .filter((place): place is Place => place != null);
}

/** Load places via raw SQL (avoids Prisma enum deserialization failures on legacy rows). */
export async function findPlacesSafe(options?: {
  where?: PlaceWhere;
  orderBy?: { displayOrder?: "asc" | "desc" } | { id?: "asc" | "desc" };
}): Promise<Place[]> {
  const where: PlaceWhere = options?.where ?? { isActive: true };
  return loadPlacesViaRaw(
    where,
    Boolean(options?.orderBy && "displayOrder" in options.orderBy)
  );
}

export async function findPlaceByIdSafe(id: string): Promise<Place | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "Place" WHERE "id" = $1 LIMIT 1`,
      id
    );
    const mapped = rows.map((row) => mapRawPlaceRow(row)).filter(Boolean);
    if (mapped[0]) return mapped[0];
  } catch (err) {
    console.warn(`[places] raw lookup failed for ${id}:`, err);
  }

  try {
    return await prisma.place.findUnique({ where: { id } });
  } catch (err) {
    console.warn(`[places] findUnique failed for ${id}:`, err);
    return null;
  }
}

export async function findPlacesByIdsSafe(ids: string[]): Promise<Place[]> {
  if (ids.length === 0) return [];
  try {
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "Place" WHERE "id" IN (${placeholders})`,
      ...ids
    );
    return rows
      .map((row) => mapRawPlaceRow(row))
      .filter((place): place is Place => place != null);
  } catch (err) {
    console.warn("[places] raw batch lookup failed:", err);
    return [];
  }
}

export async function incrementPlaceViewCountSafe(id: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "Place" SET "viewCount" = "viewCount" + 1 WHERE "id" = $1`,
    id
  );
}

export async function updatePlaceOpeningHoursSafe(
  id: string,
  openingHours: unknown
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "Place" SET "openingHours" = $1::jsonb WHERE "id" = $2`,
    JSON.stringify(openingHours),
    id
  );
}

export async function updatePlacePhotoCacheSafe(options: {
  placeId: string;
  images: string[];
  googlePlaceId?: string | null;
}): Promise<void> {
  const params: unknown[] = [options.images, options.placeId];
  let googleClause = "";
  if (options.googlePlaceId) {
    params.splice(1, 0, options.googlePlaceId);
    googleClause = `, "googlePlaceId" = $2`;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "Place" SET "images" = $1::text[]${googleClause} WHERE "id" = $${params.length}`,
    ...params
  );
}
