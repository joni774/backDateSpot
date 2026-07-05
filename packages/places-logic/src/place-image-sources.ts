import type { PlaceCategory } from "@datespot/database";
import {
  encodeGooglePhotoRef,
  fetchGooglePlacePhotoRefs,
  getGooglePlacesApiKey,
} from "./google-places";

const CATEGORY_SEARCH_TERMS: Record<PlaceCategory, string[]> = {
  ROMANTIC_DATE: ["park", "garden", "romantic"],
  RESTAURANT: ["restaurant", "מסעדה"],
  DAIRY_RESTAURANT: ["cafe", "pizza", "בית קפה"],
  MEAT_RESTAURANT: ["steakhouse", "grill", "בשר"],
  SUSHI: ["sushi", "japanese", "סושי"],
  SUNSET: ["sunset", "view", "שקיעה"],
  ATTRACTION: ["museum", "attraction", "אטרקציה"],
};

type OsmElement = {
  tags?: Record<string, string>;
};

function wikimediaFileUrl(fileName: string): string {
  const normalized = fileName.replace(/^File:/i, "");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(normalized)}?width=800`;
}

function normalizeImageUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return null;
  }
  return trimmed;
}

function tagsToImageUrl(tags: Record<string, string>): string | null {
  if (tags.image) {
    const direct = normalizeImageUrl(tags.image);
    if (direct) return direct;
  }
  if (tags["image:url"]) {
    const direct = normalizeImageUrl(tags["image:url"]);
    if (direct) return direct;
  }
  if (tags.wikimedia_commons) {
    return wikimediaFileUrl(tags.wikimedia_commons);
  }
  if (tags["wikimedia_commons:path"]) {
    return wikimediaFileUrl(tags["wikimedia_commons:path"]);
  }
  return null;
}

async function fetchOsmImageUrl(lat: number, lng: number): Promise<string | null> {
  const query =
    `[out:json][timeout:25];(` +
    `node(around:60,${lat},${lng})["image"];` +
    `node(around:60,${lat},${lng})["wikimedia_commons"];` +
    `way(around:60,${lat},${lng})["image"];` +
    `way(around:60,${lat},${lng})["wikimedia_commons"];` +
    `);out body 5;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "DateSpot/1.0 (place-photos)",
    },
    body: new URLSearchParams({ data: query }).toString(),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { elements?: OsmElement[] };
  for (const element of data.elements ?? []) {
    if (!element.tags) continue;
    const url = tagsToImageUrl(element.tags);
    if (url) return url;
  }
  return null;
}

async function fetchNominatimImageUrl(lat: number, lng: number): Promise<string | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?` +
    `lat=${lat}&lon=${lng}&format=json&extratags=1&zoom=18`;

  const res = await fetch(url, {
    headers: { "User-Agent": "DateSpot/1.0 (place-photos)" },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { extratags?: Record<string, string> };
  if (!data.extratags) return null;
  return tagsToImageUrl(data.extratags);
}

async function fetchWikimediaSearchUrl(
  query: string,
  nameHe: string,
  nameEn: string
): Promise<string | null> {
  const apiUrl =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "6",
      gsrlimit: "5",
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "800",
      origin: "*",
    }).toString();

  const res = await fetch(apiUrl);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        { title?: string; imageinfo?: Array<{ thumburl?: string; url?: string }> }
      >;
    };
  };

  const pages = data.query?.pages;
  if (!pages) return null;

  const nameHints = [nameHe, nameEn]
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 3);

  for (const page of Object.values(pages)) {
    const title = (page.title ?? "").toLowerCase();
    const matchesName = nameHints.some((hint) => title.includes(hint));
    if (!matchesName) continue;

    const info = page.imageinfo?.[0];
    if (info?.thumburl) return info.thumburl;
    if (info?.url) return info.url;
  }
  return null;
}

async function fetchWikidataNearbyImage(lat: number, lng: number): Promise<string | null> {
  const sparql = `
    SELECT ?image WHERE {
      SERVICE wikibase:around {
        ?item wdt:P625 ?location .
        bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
        bd:serviceParam wikibase:radius "0.08" .
      }
      ?item wdt:P18 ?image .
    } LIMIT 1`;

  const res = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "DateSpot/1.0 (place-photos)",
    },
    body: new URLSearchParams({ query: sparql }).toString(),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    results?: { bindings?: Array<{ image?: { value?: string } }> };
  };
  const imageUrl = data.results?.bindings?.[0]?.image?.value;
  return imageUrl ? normalizeImageUrl(imageUrl) : null;
}

function buildSearchQueries(
  nameHe: string,
  nameEn: string,
  category: PlaceCategory,
  address: string
): string[] {
  const city = address.split(" ").pop() ?? "Israel";
  const terms = CATEGORY_SEARCH_TERMS[category];
  const queries = new Set<string>();

  queries.add(`${nameHe} ${city}`);
  queries.add(`${nameEn} ${city}`);
  queries.add(`${nameHe} ${terms[0]}`);
  queries.add(`${nameEn} ${terms[0]} Israel`);
  queries.add(`${nameHe} ${terms[1] ?? terms[0]}`);

  return [...queries];
}

export function isGenericPlaceholder(images: string[]): boolean {
  if (images.length === 0) return true;
  return images.every(
    (url) =>
      url.startsWith("gpl:") ||
      url.includes("images.unsplash.com") ||
      url.includes("picsum.photos")
  );
}

export async function fetchPlaceImages(options: {
  nameHe: string;
  nameEn: string;
  category: PlaceCategory;
  latitude: number;
  longitude: number;
  address: string;
}): Promise<string[]> {
  const { nameHe, nameEn, category, latitude, longitude, address } = options;
  const googleKey = getGooglePlacesApiKey();

  if (googleKey) {
    const refs = await fetchGooglePlacePhotoRefs(
      nameHe,
      latitude,
      longitude,
      googleKey
    );
    if (refs.length > 0) return refs.map(encodeGooglePhotoRef);
  }

  const osmImage = await fetchOsmImageUrl(latitude, longitude);
  if (osmImage) return [osmImage];

  const nominatimImage = await fetchNominatimImageUrl(latitude, longitude);
  if (nominatimImage) return [nominatimImage];

  const wikidataImage = await fetchWikidataNearbyImage(latitude, longitude);
  if (wikidataImage) return [wikidataImage];

  for (const query of buildSearchQueries(nameHe, nameEn, category, address)) {
    const wikimediaImage = await fetchWikimediaSearchUrl(query, nameHe, nameEn);
    if (wikimediaImage) return [wikimediaImage];
  }

  return [];
}

export function fallbackUniqueImage(placeId: string): string {
  return `https://picsum.photos/seed/${placeId}/800/600`;
}

export const imageFetchSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
