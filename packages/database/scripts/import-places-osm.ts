/**
 * Import real places from OpenStreetMap (Overpass API) into the database.
 * Replaces demo seed places with verified OSM businesses near a center point.
 *
 * Usage:
 *   npx tsx scripts/import-places-osm.ts [lat] [lng] [radiusKm] [limit]
 * Defaults: Petah Tikva area — 31.9201, 34.8065, 20km, 40 places
 */
import { PrismaClient, PlaceCategory, PriceRange } from "@prisma/client";
import {
  encodeGooglePhotoRef,
  fetchGooglePlacePhotoRefs,
  getGooglePlacesApiKey,
  googlePlacesSleep,
} from "../../places-logic/src/google-places";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const prisma = new PrismaClient();

const DEFAULT_LAT = 31.9201;
const DEFAULT_LNG = 34.8065;
const DEFAULT_RADIUS_KM = 20;
const DEFAULT_LIMIT = 40;

const defaultHours: Record<string, string> = {
  sunday: "09:00 - 22:00",
  monday: "09:00 - 22:00",
  tuesday: "09:00 - 22:00",
  wednesday: "09:00 - 22:00",
  thursday: "09:00 - 23:00",
  friday: "09:00 - 23:00",
  saturday: "10:00 - 23:00",
};

type OsmElement = {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function pickName(tags: Record<string, string>): string {
  return (
    tags["name:he"] ||
    tags.name ||
    tags["name:en"] ||
    tags.brand ||
    tags["brand:he"] ||
    tags["brand:en"] ||
    "מקום ללא שם"
  );
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

function mapCategory(tags: Record<string, string>): PlaceCategory {
  const cuisine = (tags.cuisine || "").toLowerCase();
  const amenity = (tags.amenity || "").toLowerCase();
  const tourism = (tags.tourism || "").toLowerCase();
  const leisure = (tags.leisure || "").toLowerCase();
  const name = (tags.name || tags["name:he"] || "").toLowerCase();

  if (
    cuisine.includes("sushi") ||
    name.includes("סושי") ||
    name.includes("sushi")
  ) {
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
  if (
    tourism === "viewpoint" ||
    leisure === "beach" ||
    name.includes("שקיע")
  ) {
    return PlaceCategory.SUNSET;
  }
  if (
    tourism === "attraction" ||
    tourism === "museum" ||
    leisure === "park" ||
    leisure === "garden"
  ) {
    return tourism === "museum" || tourism === "attraction"
      ? PlaceCategory.ATTRACTION
      : PlaceCategory.ROMANTIC_DATE;
  }
  if (amenity === "restaurant" || amenity === "bar" || amenity === "fast_food") {
    return PlaceCategory.RESTAURANT;
  }
  return PlaceCategory.ATTRACTION;
}

function mapPriceRange(tags: Record<string, string>): PriceRange {
  const level = tags["price_range"] || tags["stars"];
  if (level === "1" || tags.fee === "no") return PriceRange.FREE;
  if (level === "2") return PriceRange.BUDGET;
  if (level === "4") return PriceRange.EXPENSIVE;
  return PriceRange.MODERATE;
}

function buildDescription(
  name: string,
  category: PlaceCategory,
  address: string
): { he: string; en: string; ar: string } {
  const categoryHe: Record<PlaceCategory, string> = {
    ROMANTIC_DATE: "מקום רומנטי לדייט",
    RESTAURANT: "מסעדה",
    DAIRY_RESTAURANT: "מסעדה חלבית / בית קפה",
    MEAT_RESTAURANT: "מסעדת בשרים",
    SUSHI: "מסעדת סושי",
    SUNSET: "מקום לשקיעה",
    ATTRACTION: "אטרקציה",
  };
  const categoryEn: Record<PlaceCategory, string> = {
    ROMANTIC_DATE: "Romantic date spot",
    RESTAURANT: "Restaurant",
    DAIRY_RESTAURANT: "Dairy restaurant / café",
    MEAT_RESTAURANT: "Meat restaurant",
    SUSHI: "Sushi restaurant",
    SUNSET: "Sunset viewpoint",
    ATTRACTION: "Attraction",
  };
  const kind = categoryHe[category];
  const kindEn = categoryEn[category];
  return {
    he: `${name} — ${kind}. ${address}.`,
    en: `${name} — ${kindEn}. ${address}.`,
    ar: `${name} — ${kind}. ${address}.`,
  };
}

function parseOpeningHours(tags: Record<string, string>): Record<string, string> {
  if (!tags.opening_hours) return defaultHours;
  // OSM hours are complex; keep defaults unless simple enough
  return defaultHours;
}

function elementCoords(el: OsmElement): { lat: number; lng: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lng: el.lon };
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

async function fetchOsmPlaces(
  lat: number,
  lng: number,
  radiusM: number,
  limit: number
): Promise<OsmElement[]> {
  const query = `[out:json][timeout:90];(node["amenity"~"restaurant|cafe|bar|fast_food|ice_cream"](around:${radiusM},${lat},${lng});node["tourism"~"attraction|museum|viewpoint"](around:${radiusM},${lat},${lng});node["leisure"~"park|garden"](around:${radiusM},${lat},${lng}););out body ${limit};`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "DateSpot/1.0 (places-import)",
    },
    body: new URLSearchParams({ data: query }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Overpass API failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { elements?: OsmElement[] };
  return data.elements ?? [];
}

async function main() {
  const lat = parseFloat(process.argv[2] ?? String(DEFAULT_LAT));
  const lng = parseFloat(process.argv[3] ?? String(DEFAULT_LNG));
  const radiusKm = parseFloat(process.argv[4] ?? String(DEFAULT_RADIUS_KM));
  const limit = parseInt(process.argv[5] ?? String(DEFAULT_LIMIT), 10);
  const radiusM = Math.round(radiusKm * 1000);

  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) {
    console.warn(
      "GOOGLE_PLACES_API_KEY not set — imported places will have no photos until you run db:enrich-photos"
    );
  }

  console.log(
    `Fetching OSM places near ${lat}, ${lng} (radius ${radiusKm}km, limit ${limit})...`
  );

  const elements = await fetchOsmPlaces(lat, lng, radiusM, limit);
  console.log(`Overpass returned ${elements.length} elements`);

  const seen = new Set<string>();
  const rows: Array<{
    nameHe: string;
    nameEn: string;
    nameAr: string;
    descriptionHe: string;
    descriptionEn: string;
    descriptionAr: string;
    category: PlaceCategory;
    latitude: number;
    longitude: number;
    address: string;
    priceRange: PriceRange;
    images: string[];
    openingHours: Record<string, string>;
    phone?: string;
    website?: string;
    displayOrder: number;
  }> = [];

  for (const el of elements) {
    const tags = el.tags;
    if (!tags) continue;

    const coords = elementCoords(el);
    if (!coords) continue;

    const nameHe = pickName(tags);
    if (nameHe === "מקום ללא שם") continue;

    const key = `${coords.lat.toFixed(5)}:${coords.lng.toFixed(5)}:${nameHe}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const category = mapCategory(tags);
    const address = buildAddress(tags);
    const desc = buildDescription(nameHe, category, address);

    let images: string[] = [];
    if (apiKey) {
      try {
        const refs = await fetchGooglePlacePhotoRefs(
          nameHe,
          coords.lat,
          coords.lng,
          apiKey
        );
        images = refs.map(encodeGooglePhotoRef);
        await googlePlacesSleep(200);
      } catch (err) {
        console.warn(`Google photo lookup failed for ${nameHe}:`, err);
      }
    }

    rows.push({
      nameHe,
      nameEn: pickEnglishName(tags, nameHe),
      nameAr: pickArabicName(tags, nameHe),
      descriptionHe: desc.he,
      descriptionEn: desc.en,
      descriptionAr: desc.ar,
      category,
      latitude: coords.lat,
      longitude: coords.lng,
      address,
      priceRange: mapPriceRange(tags),
      images,
      openingHours: parseOpeningHours(tags),
      phone: tags.phone || tags["contact:phone"] || undefined,
      website: tags.website || tags["contact:website"] || undefined,
      displayOrder: rows.length + 1,
    });

    if (rows.length >= limit) break;
  }

  if (rows.length === 0) {
    console.error("No places found from OSM. Try a larger radius.");
    process.exit(1);
  }

  console.log(`Importing ${rows.length} real places...`);

  const deleted = await prisma.place.deleteMany();
  console.log(`Removed ${deleted.count} demo places`);

  await prisma.place.createMany({ data: rows });
  console.log(`Created ${rows.length} OSM places`);
  console.log(
    "Sample:",
    rows.slice(0, 5).map((p) => `${p.nameHe} (${p.category})`).join(", ")
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
