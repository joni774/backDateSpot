import { type Place, type PlaceCategory } from "@datespot/database";
import {
  isCloudinaryConfigured,
  isCloudinaryUrl,
  uploadPlaceImageBuffer,
  uploadPlaceImageFromUrl,
} from "./cloudinary-storage";
import {
  decodeGooglePhotoRef,
  encodeGooglePhotoRef,
  fetchGooglePhotoBuffer,
  fetchGooglePlacePhotoRefsByPlaceId,
  getGooglePlacesApiKey,
  isDirectImageUrl,
  isGenericStockUrl,
  isRealGooglePlaceId,
  resolveGooglePlacePhotos,
} from "./google-places";
import { updatePlacePhotoCacheSafe } from "./place-query-safe";

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
      url.includes("images.unsplash.com") ||
      url.includes("picsum.photos")
  );
}

/**
 * True when the place still needs a durable business photo.
 * Cloudinary URLs count as done; bare Google `gpl:` refs do not (they expire / need API).
 */
export function needsGooglePhoto(images: string[]): boolean {
  if (images.some(isCloudinaryUrl)) return false;
  if (isGenericPlaceholder(images)) return true;
  // Stable non-stock http(s) URLs are usable, but prefer migrating them to Cloudinary.
  if (
    isCloudinaryConfigured() &&
    images.some((url) => isDirectImageUrl(url) && !isGenericStockUrl(url))
  ) {
    return true;
  }
  if (images.some((url) => isDirectImageUrl(url) && !isGenericStockUrl(url))) {
    return false;
  }
  // Only gpl: / empty → still needs enrichment
  return true;
}

/** Upload Google refs / remote URLs to Cloudinary and return durable https URLs. */
export async function materializeImagesToCloudinary(
  placeId: string,
  images: string[],
  apiKey?: string
): Promise<string[]> {
  if (!isCloudinaryConfigured() || images.length === 0) return images;

  const key = apiKey || getGooglePlacesApiKey();
  const out: string[] = [];

  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    if (isCloudinaryUrl(image)) {
      out.push(image);
      continue;
    }

    const gplRef = decodeGooglePhotoRef(image);
    if (gplRef) {
      if (key) {
        const photo = await fetchGooglePhotoBuffer(gplRef, key);
        if (photo) {
          const uploaded = await uploadPlaceImageBuffer({
            placeId,
            index,
            buffer: photo.buffer,
            contentType: photo.contentType,
          });
          if (uploaded) {
            out.push(uploaded);
            continue;
          }
        }
      }
      // Keep gpl ref if upload failed — proxy may still work when Google key is available.
      out.push(image);
      continue;
    }

    if (isDirectImageUrl(image) && !isGenericStockUrl(image)) {
      const uploaded = await uploadPlaceImageFromUrl({
        placeId,
        index,
        url: image,
      });
      out.push(uploaded ?? image);
      continue;
    }

    out.push(image);
  }

  return out.length > 0 ? out : images;
}

export type PlaceImageFetchResult = {
  images: string[];
  googlePlaceId?: string;
};

export const FOOD_CATEGORIES = new Set<PlaceCategory>([
  "RESTAURANT",
  "SUSHI",
  "MEAT_RESTAURANT",
  "DAIRY_RESTAURANT",
]);

export async function fetchPlaceImages(options: {
  nameHe: string;
  nameEn: string;
  category: PlaceCategory;
  latitude: number;
  longitude: number;
  address: string;
  googlePlaceId?: string | null;
}): Promise<PlaceImageFetchResult> {
  const { nameHe, nameEn, category, latitude, longitude, address, googlePlaceId } = options;
  const googleKey = getGooglePlacesApiKey();
  const realGooglePlaceId = isRealGooglePlaceId(googlePlaceId) ? googlePlaceId!.trim() : null;

  if (googleKey) {
    const resolved = await resolveGooglePlacePhotos({
      apiKey: googleKey,
      nameHe,
      nameEn,
      lat: latitude,
      lng: longitude,
      googlePlaceId: realGooglePlaceId,
      address,
    });
    if (resolved.refs.length > 0) {
      return {
        images: resolved.refs.map(encodeGooglePhotoRef),
        googlePlaceId: resolved.googlePlaceId,
      };
    }
    if (FOOD_CATEGORIES.has(category)) {
      return { images: [] };
    }
  }

  const osmImage = await fetchOsmImageUrl(latitude, longitude);
  if (osmImage) return { images: [osmImage] };

  const nominatimImage = await fetchNominatimImageUrl(latitude, longitude);
  if (nominatimImage) return { images: [nominatimImage] };

  const wikidataImage = await fetchWikidataNearbyImage(latitude, longitude);
  if (wikidataImage) return { images: [wikidataImage] };

  for (const query of buildSearchQueries(nameHe, nameEn, category, address)) {
    const wikimediaImage = await fetchWikimediaSearchUrl(query, nameHe, nameEn);
    if (wikimediaImage) return { images: [wikimediaImage] };
  }

  return { images: [] };
}

/** Persist place images (prefer Cloudinary URLs) and optionally link googlePlaceId. */
export async function persistPlacePhotoCache(options: {
  placeId: string;
  images: string[];
  googlePlaceId?: string;
}): Promise<void> {
  const images = await materializeImagesToCloudinary(options.placeId, options.images);
  const googlePlaceId =
    options.googlePlaceId && isRealGooglePlaceId(options.googlePlaceId)
      ? options.googlePlaceId.trim()
      : undefined;

  try {
    await updatePlacePhotoCacheSafe({
      placeId: options.placeId,
      images,
      googlePlaceId,
    });
  } catch (err) {
    console.warn(`[places] photo cache persist failed for ${options.placeId}:`, err);
    try {
      await updatePlacePhotoCacheSafe({ placeId: options.placeId, images });
    } catch (innerErr) {
      console.warn(`[places] photo cache images-only persist failed:`, innerErr);
    }
  }
}

/** Fetch Google photos for restaurants still using stock/empty images. Mutates `places`. */
export async function attachGooglePhotosToPlaces(
  places: Place[],
  apiKey: string,
  limit = 4
): Promise<void> {
  const pending = [...places]
    .sort((a, b) => Number(FOOD_CATEGORIES.has(b.category)) - Number(FOOD_CATEGORIES.has(a.category)))
    .filter((place) => needsGooglePhoto(place.images))
    .slice(0, limit);

  for (const place of pending) {
    try {
      const fetched = await fetchPlaceImages({
        nameHe: place.nameHe,
        nameEn: place.nameEn,
        category: place.category,
        latitude: place.latitude,
        longitude: place.longitude,
        address: place.address,
        googlePlaceId: place.googlePlaceId,
      });
      if (fetched.images.length === 0) continue;
      await persistPlacePhotoCache({
        placeId: place.id,
        images: fetched.images,
        googlePlaceId: fetched.googlePlaceId,
      });
      place.images = fetched.images;
    } catch (err) {
      console.warn(`[places] Google photo skipped for ${place.nameHe}:`, err);
    }
  }
}

export function fallbackUniqueImage(placeId: string): string {
  return `https://picsum.photos/seed/${placeId}/800/600`;
}

export const imageFetchSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
