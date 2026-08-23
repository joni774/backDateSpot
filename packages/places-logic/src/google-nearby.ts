import {
  prisma,
  PlaceCategory,
  PriceRange,
} from "@datespot/database";
import type { PlacesListCache } from "./cache";
import {
  encodeGooglePhotoRef,
  fetchGoogleOpeningHoursByPlaceId,
} from "./google-places";
import {
  emptyOpeningHours,
  hasUsableOpeningHours,
} from "./utils/opening-hours";

const GOOGLE_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const INGEST_TTL_SECONDS = 15 * 60;
const MAX_GOOGLE_RADIUS_M = 50_000;
const HOURS_CONCURRENCY = 5;
const localIngestAt = new Map<string, number>();

type GooglePhoto = { photo_reference: string };

type GoogleNearbyResult = {
  place_id?: string;
  name?: string;
  vicinity?: string;
  types?: string[];
  price_level?: number;
  photos?: GooglePhoto[];
  geometry?: { location?: { lat?: number; lng?: number } };
};

type GoogleNearbyResponse = {
  status: string;
  results?: GoogleNearbyResult[];
  error_message?: string;
};

type SearchSpec = { type?: string; keyword?: string };

function gridCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function radiusMeters(radiusKm: number): number {
  return Math.min(MAX_GOOGLE_RADIUS_M, Math.max(500, Math.round(radiusKm * 1000)));
}

function specsForCategory(category?: string): SearchSpec[] {
  switch (category) {
    case "SUSHI":
      return [{ type: "restaurant", keyword: "sushi" }];
    case "MEAT_RESTAURANT":
      return [
        { type: "restaurant", keyword: "steak" },
        { type: "restaurant", keyword: "grill" },
      ];
    case "DAIRY_RESTAURANT":
      return [{ type: "cafe" }, { type: "bakery" }];
    case "RESTAURANT":
      return [
        { type: "restaurant" },
        { type: "cafe" },
        { type: "meal_takeaway" },
      ];
    case "ATTRACTION":
      return [{ type: "tourist_attraction" }, { type: "museum" }];
    case "SUNSET":
      return [{ type: "park" }, { keyword: "beach" }];
    case "ROMANTIC_DATE":
      return [
        { type: "bar" },
        { type: "night_club" },
        { type: "cafe" },
        { keyword: "pub" },
      ];
    default:
      return [
        { type: "restaurant" },
        { type: "cafe" },
        { type: "bar" },
        { type: "night_club" },
        { type: "tourist_attraction" },
      ];
  }
}

function resolveCategory(types: string[], requested?: string): PlaceCategory {
  if (
    requested === "SUSHI" ||
    requested === "MEAT_RESTAURANT" ||
    requested === "DAIRY_RESTAURANT"
  ) {
    return requested as PlaceCategory;
  }
  return mapCategory(types);
}

function mapCategory(types: string[]): PlaceCategory {
  if (types.includes("sushi_restaurant")) return PlaceCategory.SUSHI;
  if (types.includes("steak_house") || types.includes("barbecue")) {
    return PlaceCategory.MEAT_RESTAURANT;
  }
  if (types.includes("cafe") || types.includes("bakery")) {
    return PlaceCategory.DAIRY_RESTAURANT;
  }
  if (types.includes("night_club") || types.includes("bar")) {
    return PlaceCategory.ROMANTIC_DATE;
  }
  if (types.includes("park") || types.includes("campground")) {
    return PlaceCategory.SUNSET;
  }
  if (
    types.includes("tourist_attraction") ||
    types.includes("museum") ||
    types.includes("art_gallery") ||
    types.includes("zoo") ||
    types.includes("amusement_park") ||
    types.includes("aquarium")
  ) {
    return PlaceCategory.ATTRACTION;
  }
  if (
    types.includes("restaurant") ||
    types.includes("meal_takeaway") ||
    types.includes("food")
  ) {
    return PlaceCategory.RESTAURANT;
  }
  return PlaceCategory.ATTRACTION;
}

function mapPrice(level: number | undefined): PriceRange {
  if (level == null || level <= 0) return PriceRange.BUDGET;
  if (level === 1) return PriceRange.BUDGET;
  if (level === 2) return PriceRange.MODERATE;
  return PriceRange.EXPENSIVE;
}

function fallbackDescription(name: string, language: "he" | "en" | "ar"): string {
  if (language === "ar") return `${name} — مكان قريب للخروج.`;
  if (language === "en") return `${name} — a nearby spot for a night out.`;
  return `${name} — מקום בקרבתך ליציאה.`;
}

async function fetchNearby(
  apiKey: string,
  lat: number,
  lng: number,
  radiusM: number,
  language: "he" | "en" | "ar",
  spec: SearchSpec
): Promise<GoogleNearbyResult[]> {
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: String(radiusM),
    language,
    key: apiKey,
  });
  if (spec.type) params.set("type", spec.type);
  if (spec.keyword) params.set("keyword", spec.keyword);

  const res = await fetch(`${GOOGLE_NEARBY_URL}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Google Nearby HTTP ${res.status}`);
  }
  const data = (await res.json()) as GoogleNearbyResponse;
  if (data.status === "ZERO_RESULTS") return [];
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message || `Google Nearby ${data.status}`);
  }
  return data.results ?? [];
}

async function upsertGooglePlace(
  result: GoogleNearbyResult,
  language: "he" | "en" | "ar",
  apiKey: string,
  requestedCategory?: string
): Promise<void> {
  const googlePlaceId = result.place_id?.trim();
  const name = result.name?.trim();
  const lat = result.geometry?.location?.lat;
  const lng = result.geometry?.location?.lng;
  if (!googlePlaceId || !name || lat == null || lng == null) return;

  const types = result.types ?? [];
  const address = result.vicinity?.trim() || name;
  const description = fallbackDescription(name, language);
  const images = (result.photos ?? [])
    .slice(0, 3)
    .map((photo) => encodeGooglePhotoRef(photo.photo_reference));

  const existing = await prisma.place.findUnique({
    where: { googlePlaceId },
    select: { openingHours: true },
  });

  let openingHours = emptyOpeningHours();
  let shouldFetchHours = !hasUsableOpeningHours(existing?.openingHours);
  if (shouldFetchHours) {
    try {
      const fromGoogle = await fetchGoogleOpeningHoursByPlaceId(googlePlaceId, apiKey);
      if (fromGoogle) openingHours = fromGoogle;
    } catch (err) {
      console.warn(`[places] opening hours for ${name}:`, err);
    }
  } else {
    openingHours = existing!.openingHours as typeof openingHours;
  }

  await prisma.place.upsert({
    where: { googlePlaceId },
    create: {
      googlePlaceId,
      nameHe: name,
      nameEn: name,
      nameAr: name,
      descriptionHe: description,
      descriptionEn: description,
      descriptionAr: description,
      category: resolveCategory(types, requestedCategory),
      latitude: lat,
      longitude: lng,
      address,
      priceRange: mapPrice(result.price_level),
      images,
      openingHours,
      displayOrder: 500,
    },
    update: {
      nameHe: name,
      nameEn: name,
      nameAr: name,
      latitude: lat,
      longitude: lng,
      address,
      priceRange: mapPrice(result.price_level),
      ...(images.length > 0 ? { images } : {}),
      ...(shouldFetchHours && hasUsableOpeningHours(openingHours)
        ? { openingHours }
        : {}),
      isActive: true,
    },
  });
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      if (current === undefined) return;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

export async function ingestGoogleNearbyPlaces(options: {
  apiKey: string;
  lat: number;
  lng: number;
  radiusKm: number;
  language: "he" | "en" | "ar";
  category?: string;
  cache: PlacesListCache;
}): Promise<void> {
  const { apiKey, lat, lng, radiusKm, language, category, cache } = options;
  const ingestKey = [
    "places:google-ingest",
    gridCoord(lat),
    gridCoord(lng),
    Math.round(radiusKm),
    category ?? "all",
    language,
  ].join(":");

  const already = await cache.get(ingestKey);
  const localAt = localIngestAt.get(ingestKey);
  if (already || (localAt && Date.now() - localAt < INGEST_TTL_SECONDS * 1000)) {
    return;
  }
  localIngestAt.set(ingestKey, Date.now());

  const radiusM = radiusMeters(radiusKm);
  const specs = specsForCategory(category);
  const batches = await Promise.allSettled(
    specs.map((spec) => fetchNearby(apiKey, lat, lng, radiusM, language, spec))
  );

  const anyOk = batches.some((batch) => batch.status === "fulfilled");
  if (!anyOk) {
    localIngestAt.delete(ingestKey);
    return;
  }

  const seen = new Set<string>();
  const unique: GoogleNearbyResult[] = [];
  for (const batch of batches) {
    if (batch.status !== "fulfilled") {
      console.warn("[places] Google Nearby search failed:", batch.reason);
      continue;
    }
    for (const result of batch.value) {
      const id = result.place_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(result);
    }
  }

  await mapPool(unique.slice(0, 80), HOURS_CONCURRENCY, (result) =>
    upsertGooglePlace(result, language, apiKey, category)
  );
  await cache.set(ingestKey, "1", INGEST_TTL_SECONDS);
}
