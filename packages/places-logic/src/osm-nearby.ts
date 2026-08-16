import {
  prisma,
  PlaceCategory,
  PriceRange,
} from "@datespot/database";
import type { PlacesListCache } from "./cache";
import { fallbackUniqueImage } from "./place-image-sources";

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const INGEST_TTL_SECONDS = 15 * 60;
const MAX_PLACES = 80;
const localIngestAt = new Map<string, number>();

type OsmElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function gridCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function radiusMeters(radiusKm: number): number {
  return Math.min(50_000, Math.max(800, Math.round(radiusKm * 1000)));
}

function overpassFilters(category?: string): string[] {
  switch (category) {
    case "SUSHI":
      return [
        `["amenity"~"restaurant|fast_food"]["cuisine"~"sushi|japanese",i]`,
        `["name"~"סושי|sushi",i]["amenity"~"restaurant|fast_food"]`,
      ];
    case "MEAT_RESTAURANT":
      return [
        `["amenity"="restaurant"]["cuisine"~"steak|grill|burger|meat|barbecue|kebab",i]`,
        `["name"~"סטייק|בשר|grill|steak|burger",i]["amenity"="restaurant"]`,
      ];
    case "DAIRY_RESTAURANT":
      return [
        `["amenity"~"cafe|ice_cream"]`,
        `["amenity"="restaurant"]["cuisine"~"pizza|dairy|vegetarian|coffee",i]`,
      ];
    case "RESTAURANT":
      return [`["amenity"~"restaurant|cafe|fast_food|ice_cream"]`];
    case "ROMANTIC_DATE":
      return [
        `["amenity"~"bar|pub|nightclub"]`,
        `["leisure"~"park|garden"]`,
      ];
    case "SUNSET":
      return [`["tourism"="viewpoint"]`, `["leisure"="beach"]`];
    case "ATTRACTION":
      return [`["tourism"~"attraction|museum"]`];
    default:
      return [
        `["amenity"~"restaurant|cafe|bar|pub|nightclub|fast_food|ice_cream"]`,
        `["tourism"~"attraction|museum|viewpoint"]`,
      ];
  }
}

function mapOsmCategory(tags: Record<string, string>, requested?: string): PlaceCategory {
  if (requested === "SUSHI" || requested === "MEAT_RESTAURANT" || requested === "DAIRY_RESTAURANT") {
    return requested as PlaceCategory;
  }

  const cuisine = (tags.cuisine || "").toLowerCase();
  const amenity = (tags.amenity || "").toLowerCase();
  const tourism = (tags.tourism || "").toLowerCase();
  const leisure = (tags.leisure || "").toLowerCase();
  const name = (tags.name || tags["name:he"] || "").toLowerCase();

  if (cuisine.includes("sushi") || name.includes("סושי") || name.includes("sushi")) {
    return PlaceCategory.SUSHI;
  }
  if (
    cuisine.includes("steak") ||
    cuisine.includes("grill") ||
    cuisine.includes("burger") ||
    cuisine.includes("meat") ||
    name.includes("בשר")
  ) {
    return PlaceCategory.MEAT_RESTAURANT;
  }
  if (amenity === "bar" || amenity === "pub" || amenity === "nightclub") {
    return PlaceCategory.ROMANTIC_DATE;
  }
  if (
    cuisine.includes("pizza") ||
    cuisine.includes("dairy") ||
    cuisine.includes("vegetarian") ||
    cuisine.includes("coffee") ||
    amenity === "cafe" ||
    amenity === "ice_cream"
  ) {
    return PlaceCategory.DAIRY_RESTAURANT;
  }
  if (tourism === "viewpoint" || leisure === "beach" || name.includes("שקיע")) {
    return PlaceCategory.SUNSET;
  }
  if (tourism === "attraction" || tourism === "museum") {
    return PlaceCategory.ATTRACTION;
  }
  if (leisure === "park" || leisure === "garden") {
    return PlaceCategory.ROMANTIC_DATE;
  }
  if (amenity === "restaurant" || amenity === "fast_food") {
    return PlaceCategory.RESTAURANT;
  }
  if (requested === "RESTAURANT" || requested === "ROMANTIC_DATE" || requested === "ATTRACTION" || requested === "SUNSET") {
    return requested as PlaceCategory;
  }
  return PlaceCategory.ATTRACTION;
}

function pickName(tags: Record<string, string>): string | null {
  const name =
    tags["name:he"] ||
    tags.name ||
    tags["name:en"] ||
    tags.brand ||
    tags["brand:he"] ||
    tags["brand:en"];
  const trimmed = name?.trim();
  return trimmed || null;
}

function pickEnglishName(tags: Record<string, string>, fallback: string): string {
  return tags["name:en"] || tags.brand || tags.name || fallback;
}

function pickArabicName(tags: Record<string, string>, fallback: string): string {
  return tags["name:ar"] || tags["name:he"] || tags.name || fallback;
}

function buildAddress(tags: Record<string, string>): string {
  if (tags["addr:full"]) return tags["addr:full"];
  const parts = [
    tags["addr:street"],
    tags["addr:housenumber"],
    tags["addr:city"],
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "ישראל";
}

function fallbackDescription(name: string, language: "he" | "en" | "ar"): string {
  if (language === "ar") return `${name} — مكان قريب للخروج.`;
  if (language === "en") return `${name} — a nearby spot for a night out.`;
  return `${name} — מקום בקרבתך ליציאה.`;
}

function elementCoords(el: OsmElement): { lat: number; lng: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lng: el.lon };
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

async function fetchOverpass(
  lat: number,
  lng: number,
  radiusM: number,
  category?: string
): Promise<OsmElement[]> {
  const filters = overpassFilters(category);
  const around = `(around:${radiusM},${lat},${lng})`;
  const clauses = filters
    .map((filter) => `node${filter}${around};way${filter}${around};`)
    .join("");
  const query = `[out:json][timeout:20];(${clauses});out center ${MAX_PLACES};`;

  let lastError: unknown;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "DateSpot/1.0 (nearby-places)",
        },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (!res.ok) {
        lastError = new Error(`Overpass HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { elements?: OsmElement[] };
      return data.elements ?? [];
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Overpass request failed");
}

async function upsertOsmPlace(
  element: OsmElement,
  language: "he" | "en" | "ar",
  requestedCategory?: string
): Promise<void> {
  const tags = element.tags;
  if (!tags || element.id == null) return;
  const name = pickName(tags);
  const coords = elementCoords(element);
  if (!name || !coords) return;

  const externalId = `osm:${element.type ?? "node"}:${element.id}`;
  const category = mapOsmCategory(tags, requestedCategory);
  const address = buildAddress(tags);
  const description = fallbackDescription(name, language);
  const image = fallbackUniqueImage(externalId);

  await prisma.place.upsert({
    where: { googlePlaceId: externalId },
    create: {
      googlePlaceId: externalId,
      nameHe: name,
      nameEn: pickEnglishName(tags, name),
      nameAr: pickArabicName(tags, name),
      descriptionHe: description,
      descriptionEn: description,
      descriptionAr: description,
      category,
      latitude: coords.lat,
      longitude: coords.lng,
      address,
      priceRange: PriceRange.MODERATE,
      images: [image],
      openingHours: {},
      phone: tags.phone || tags["contact:phone"] || undefined,
      website: tags.website || tags["contact:website"] || undefined,
      displayOrder: 500,
    },
    update: {
      nameHe: name,
      nameEn: pickEnglishName(tags, name),
      nameAr: pickArabicName(tags, name),
      latitude: coords.lat,
      longitude: coords.lng,
      address,
      isActive: true,
      category,
    },
  });
}

export async function ingestOsmNearbyPlaces(options: {
  lat: number;
  lng: number;
  radiusKm: number;
  language: "he" | "en" | "ar";
  category?: string;
  cache: PlacesListCache;
}): Promise<number> {
  const { lat, lng, radiusKm, language, category, cache } = options;
  const ingestKey = [
    "places:osm-ingest",
    gridCoord(lat),
    gridCoord(lng),
    Math.round(radiusKm),
    category ?? "all",
    language,
  ].join(":");

  const already = await cache.get(ingestKey);
  const localAt = localIngestAt.get(ingestKey);
  if (already || (localAt && Date.now() - localAt < INGEST_TTL_SECONDS * 1000)) {
    return 0;
  }
  localIngestAt.set(ingestKey, Date.now());

  try {
    const elements = await fetchOverpass(lat, lng, radiusMeters(radiusKm), category);
    const seen = new Set<string>();
    const unique: OsmElement[] = [];
    for (const element of elements) {
      const id = `${element.type ?? "node"}:${element.id}`;
      if (element.id == null || seen.has(id)) continue;
      seen.add(id);
      unique.push(element);
    }

    const saved = await Promise.allSettled(
      unique.slice(0, MAX_PLACES).map((element) =>
        upsertOsmPlace(element, language, category)
      )
    );
    const created = saved.filter((row) => row.status === "fulfilled").length;
    await cache.set(ingestKey, "1", INGEST_TTL_SECONDS);
    return created;
  } catch (err) {
    localIngestAt.delete(ingestKey);
    console.warn("[places] OSM Nearby ingest skipped:", err);
    return 0;
  }
}
