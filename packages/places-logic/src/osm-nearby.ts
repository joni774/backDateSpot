import {
  prisma,
  PlaceCategory,
  PriceRange,
} from "@datespot/database";
import { getDistanceKm } from "@datespot/utils";
import type { PlacesListCache } from "./cache";
import { fallbackUniqueImage } from "./place-image-sources";

const PHOTON_URL = "https://photon.komoot.io/reverse";
const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];
const INGEST_TTL_SECONDS = 15 * 60;
const MAX_PLACES = 80;
const FETCH_TIMEOUT_MS = 8000;
const localIngestAt = new Map<string, number>();

type NearbyHit = {
  externalId: string;
  nameHe: string;
  nameEn: string;
  nameAr: string;
  lat: number;
  lng: number;
  address: string;
  category: PlaceCategory;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    country?: string;
  };
};

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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mapAmenityCategory(value: string, name: string): PlaceCategory {
  const v = value.toLowerCase();
  const n = name.toLowerCase();
  if (v === "sushi" || n.includes("סושי") || n.includes("sushi")) {
    return PlaceCategory.SUSHI;
  }
  if (
    v.includes("steak") ||
    n.includes("בשר") ||
    n.includes("steak") ||
    n.includes("grill")
  ) {
    return PlaceCategory.MEAT_RESTAURANT;
  }
  if (v === "bar" || v === "pub" || v === "nightclub") {
    return PlaceCategory.ROMANTIC_DATE;
  }
  if (v === "cafe" || v === "ice_cream" || v === "bakery") {
    return PlaceCategory.DAIRY_RESTAURANT;
  }
  if (v === "viewpoint" || v === "beach") return PlaceCategory.SUNSET;
  if (v === "attraction" || v === "museum") return PlaceCategory.ATTRACTION;
  if (v === "park" || v === "garden") return PlaceCategory.ROMANTIC_DATE;
  if (v === "restaurant" || v === "fast_food") return PlaceCategory.RESTAURANT;
  return PlaceCategory.RESTAURANT;
}

function fallbackDescription(name: string, language: "he" | "en" | "ar"): string {
  if (language === "ar") return `${name} — مكان قريب للخروج.`;
  if (language === "en") return `${name} — a nearby spot for a night out.`;
  return `${name} — מקום בקרבתך ליציאה.`;
}

function mapPhotonHits(
  features: PhotonFeature[],
  originLat: number,
  originLng: number,
  radiusKm: number
): NearbyHit[] {
  const hits: NearbyHit[] = [];
  for (const feature of features) {
    const props = feature.properties;
    const coords = feature.geometry?.coordinates;
    if (!props?.osm_id || !coords || coords.length < 2) continue;
    const name = props.name?.trim();
    if (!name) continue;
    const lng = coords[0];
    const lat = coords[1];
    if (getDistanceKm(originLat, originLng, lat, lng) > radiusKm) continue;
    const osmType =
      props.osm_type === "W" ? "way" : props.osm_type === "R" ? "relation" : "node";
    const address = [props.street, props.housenumber, props.city]
      .filter(Boolean)
      .join(" ") || props.country || "ישראל";
    hits.push({
      externalId: `osm:${osmType}:${props.osm_id}`,
      nameHe: name,
      nameEn: name,
      nameAr: name,
      lat,
      lng,
      address,
      category: mapAmenityCategory(props.osm_value ?? "", name),
    });
  }
  return hits;
}

async function fetchPhotonGroup(
  lat: number,
  lng: number,
  radiusKm: number,
  tags: string[]
): Promise<PhotonFeature[]> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    radius: String(Math.min(50, Math.max(1, radiusKm))),
    limit: "50",
  });
  for (const tag of tags) params.append("osm_tag", tag);
  const res = await fetchWithTimeout(`${PHOTON_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "DateSpot/1.0 (nearby-places)",
    },
  });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  return data.features ?? [];
}

async function fetchPhotonNearby(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<NearbyHit[]> {
  const groups = [
    ["amenity:restaurant", "amenity:cafe", "amenity:fast_food", "amenity:ice_cream"],
    ["amenity:bar", "amenity:pub", "amenity:nightclub"],
    ["tourism:attraction", "tourism:museum", "tourism:viewpoint"],
  ];
  const batches = await Promise.allSettled(
    groups.map((tags) => fetchPhotonGroup(lat, lng, radiusKm, tags))
  );
  const hits: NearbyHit[] = [];
  const seen = new Set<string>();
  for (const batch of batches) {
    if (batch.status !== "fulfilled") {
      console.warn("[places] Photon group failed:", batch.reason);
      continue;
    }
    for (const hit of mapPhotonHits(batch.value, lat, lng, radiusKm)) {
      if (seen.has(hit.externalId)) continue;
      seen.add(hit.externalId);
      hits.push(hit);
    }
  }
  return hits;
}

function mapOsmCategory(tags: Record<string, string>): PlaceCategory {
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
    amenity === "cafe" ||
    amenity === "ice_cream" ||
    cuisine.includes("pizza") ||
    cuisine.includes("coffee")
  ) {
    return PlaceCategory.DAIRY_RESTAURANT;
  }
  if (tourism === "viewpoint" || leisure === "beach") return PlaceCategory.SUNSET;
  if (tourism === "attraction" || tourism === "museum") return PlaceCategory.ATTRACTION;
  if (leisure === "park" || leisure === "garden") return PlaceCategory.ROMANTIC_DATE;
  if (amenity === "restaurant" || amenity === "fast_food") return PlaceCategory.RESTAURANT;
  return PlaceCategory.RESTAURANT;
}

function pickName(tags: Record<string, string>): string | null {
  const name =
    tags["name:he"] ||
    tags.name ||
    tags["name:en"] ||
    tags.brand ||
    tags["brand:he"] ||
    tags["brand:en"];
  return name?.trim() || null;
}

function elementToHit(element: OsmElement): NearbyHit | null {
  const tags = element.tags;
  if (!tags || element.id == null) return null;
  const name = pickName(tags);
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (!name || lat == null || lng == null) return null;
  const address = tags["addr:full"] ||
    [tags["addr:street"], tags["addr:housenumber"], tags["addr:city"]]
      .filter(Boolean)
      .join(" ") || "ישראל";
  return {
    externalId: `osm:${element.type ?? "node"}:${element.id}`,
    nameHe: name,
    nameEn: tags["name:en"] || tags.brand || tags.name || name,
    nameAr: tags["name:ar"] || name,
    lat,
    lng,
    address,
    category: mapOsmCategory(tags),
  };
}

async function fetchOverpassNearby(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<NearbyHit[]> {
  const radiusM = radiusMeters(radiusKm);
  const around = `(around:${radiusM},${lat},${lng})`;
  const query =
    `[out:json][timeout:8];(` +
    `node["amenity"~"restaurant|cafe|bar|pub|nightclub|fast_food|ice_cream"]${around};` +
    `node["tourism"~"attraction|museum|viewpoint"]${around};` +
    `);out body ${MAX_PLACES};`;

  const bodies = OVERPASS_URLS.map((url) =>
    fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "DateSpot/1.0 (nearby-places)",
      },
      body: new URLSearchParams({ data: query }).toString(),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      return (await res.json()) as { elements?: OsmElement[] };
    })
  );

  const winner = await Promise.any(bodies);
  const hits: NearbyHit[] = [];
  const seen = new Set<string>();
  for (const element of winner.elements ?? []) {
    const hit = elementToHit(element);
    if (!hit || seen.has(hit.externalId)) continue;
    seen.add(hit.externalId);
    hits.push(hit);
  }
  return hits;
}

async function upsertHit(
  hit: NearbyHit,
  language: "he" | "en" | "ar"
): Promise<void> {
  const description = fallbackDescription(hit.nameHe, language);
  const image = fallbackUniqueImage(hit.externalId);
  await prisma.place.upsert({
    where: { googlePlaceId: hit.externalId },
    create: {
      googlePlaceId: hit.externalId,
      nameHe: hit.nameHe,
      nameEn: hit.nameEn,
      nameAr: hit.nameAr,
      descriptionHe: description,
      descriptionEn: description,
      descriptionAr: description,
      category: hit.category,
      latitude: hit.lat,
      longitude: hit.lng,
      address: hit.address,
      priceRange: PriceRange.MODERATE,
      images: [image],
      openingHours: {},
      displayOrder: 500,
    },
    update: {
      nameHe: hit.nameHe,
      nameEn: hit.nameEn,
      nameAr: hit.nameAr,
      latitude: hit.lat,
      longitude: hit.lng,
      address: hit.address,
      isActive: true,
      category: hit.category,
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
  const { lat, lng, radiusKm, language, cache } = options;
  const ingestKey = [
    "places:osm-ingest",
    gridCoord(lat),
    gridCoord(lng),
    Math.round(radiusKm),
  ].join(":");

  const already = await cache.get(ingestKey);
  const localAt = localIngestAt.get(ingestKey);
  if (already || (localAt && Date.now() - localAt < INGEST_TTL_SECONDS * 1000)) {
    return 0;
  }
  localIngestAt.set(ingestKey, Date.now());

  try {
    let hits = await fetchPhotonNearby(lat, lng, radiusKm);
    if (hits.length < 8) {
      try {
        const extra = await fetchOverpassNearby(lat, lng, radiusKm);
        const seen = new Set(hits.map((hit) => hit.externalId));
        for (const hit of extra) {
          if (seen.has(hit.externalId)) continue;
          seen.add(hit.externalId);
          hits.push(hit);
        }
      } catch (err) {
        console.warn("[places] Overpass fallback skipped:", err);
      }
    }

    if (hits.length === 0) {
      localIngestAt.delete(ingestKey);
      return 0;
    }

    const saved = await Promise.allSettled(
      hits.slice(0, MAX_PLACES).map((hit) => upsertHit(hit, language))
    );
    const created = saved.filter((row) => row.status === "fulfilled").length;
    if (created > 0) {
      await cache.set(ingestKey, "1", INGEST_TTL_SECONDS);
    } else {
      localIngestAt.delete(ingestKey);
    }
    return created;
  } catch (err) {
    localIngestAt.delete(ingestKey);
    console.warn("[places] Nearby ingest skipped:", err);
    return 0;
  }
}
