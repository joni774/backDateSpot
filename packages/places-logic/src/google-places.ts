import { getDistanceKm } from "@datespot/utils";
import {
  normalizeGoogleOpeningHours,
  type GoogleOpeningHours,
  type OpeningHoursMap,
} from "./utils/opening-hours";

const GOOGLE_PHOTO_PREFIX = "gpl:";
/** Reject Google matches that are clearly a different nearby business. */
const MAX_MATCH_KM = 0.3;
/** Within this distance, accept a partial name match (OSM coords are often offset). */
const TIGHT_MATCH_KM = 0.08;
const SEARCH_RADIUS_M = 150;

type GooglePhoto = { photo_reference: string };

type GoogleLocation = { lat?: number; lng?: number };

type FindPlaceCandidate = {
  place_id?: string;
  name?: string;
  photos?: GooglePhoto[];
  geometry?: { location?: GoogleLocation };
};

type FindPlaceResponse = {
  status: string;
  candidates?: FindPlaceCandidate[];
};

type PlaceDetailsResponse = {
  status: string;
  result?: {
    photos?: GooglePhoto[];
    opening_hours?: GoogleOpeningHours;
    place_id?: string;
  };
};

type NearbySearchResponse = {
  status: string;
  results?: Array<{
    place_id?: string;
    name?: string;
    photos?: GooglePhoto[];
    geometry?: { location?: GoogleLocation };
  }>;
};

type TextSearchResponse = {
  status: string;
  results?: Array<{
    place_id?: string;
    name?: string;
    photos?: GooglePhoto[];
    geometry?: { location?: GoogleLocation };
  }>;
};

type PhotoCandidate = {
  placeId: string;
  name?: string;
  refs: string[];
  location?: GoogleLocation;
};

type PhotoLookup = {
  placeId?: string;
  refs: string[];
};

export function getGooglePlacesApiKey(): string | undefined {
  return (
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    undefined
  );
}

export function encodeGooglePhotoRef(ref: string): string {
  return `${GOOGLE_PHOTO_PREFIX}${ref}`;
}

export function decodeGooglePhotoRef(value: string): string | null {
  if (value.startsWith(GOOGLE_PHOTO_PREFIX)) {
    return value.slice(GOOGLE_PHOTO_PREFIX.length);
  }
  return null;
}

/** True for stock/placeholder URLs — not photos of the actual business. */
export function isGenericStockUrl(url: string): boolean {
  return url.includes("images.unsplash.com") || url.includes("picsum.photos");
}

/** True for stable http(s) URLs we can return to clients as-is (not encoded Google refs or stock). */
export function isDirectImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return false;
  if (decodeGooglePhotoRef(trimmed)) return false;
  return !isGenericStockUrl(trimmed);
}

/**
 * Build client-facing image URLs. Google photo refs expire — use place-id proxy URLs
 * so the server can fetch fresh refs on each request.
 */
export function resolvePlaceImageUrls(
  images: string[],
  baseUrl: string,
  placeId?: string
): string[] {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const direct = images.filter(isDirectImageUrl);
  if (direct.length > 0) return direct;

  if (placeId) {
    const gplCount = images.filter((img) => decodeGooglePhotoRef(img)).length;
    const slots = Math.max(gplCount, 1);
    return Array.from({ length: Math.min(slots, 5) }, (_, index) =>
      `${normalizedBase}/api/places/${placeId}/photo/${index}`
    );
  }

  return images.map((image) => {
    const ref = decodeGooglePhotoRef(image);
    if (!ref) return image;
    return `${normalizedBase}/api/places/photo?ref=${encodeURIComponent(ref)}`;
  });
}

export function buildGooglePhotoFetchUrl(ref: string, apiKey: string): string {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${encodeURIComponent(ref)}&key=${apiKey}`;
}

export async function fetchGooglePhotoBuffer(
  ref: string,
  apiKey: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const photoUrl = buildGooglePhotoFetchUrl(ref, apiKey);
  const photoRes = await fetch(photoUrl, { redirect: "follow" });
  if (!photoRes.ok) return null;
  return {
    buffer: Buffer.from(await photoRes.arrayBuffer()),
    contentType: photoRes.headers.get("content-type") ?? "image/jpeg",
  };
}


function normalizeBusinessName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when a Google result name plausibly matches our place name. */
export function businessNamesMatch(expected: string, candidate: string): boolean {
  const a = normalizeBusinessName(expected);
  const b = normalizeBusinessName(candidate);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const tokensA = a.split(/\s+/).filter((token) => token.length >= 2);
  const tokensB = new Set(b.split(/\s+/).filter((token) => token.length >= 2));
  if (tokensA.length === 0 || tokensB.size === 0) return false;

  const overlap = tokensA.filter((token) => tokensB.has(token)).length;
  const minLen = Math.min(tokensA.length, tokensB.size);
  return overlap >= Math.max(1, Math.ceil(minLen / 2));
}

function matchesAnyExpectedName(
  candidateName: string | undefined,
  expectedNames: string[]
): boolean {
  if (!candidateName?.trim()) return false;
  return expectedNames.some((name) => businessNamesMatch(name, candidateName));
}

function distanceKmFrom(lat: number, lng: number, location?: GoogleLocation): number {
  if (location?.lat == null || location?.lng == null) return 0;
  return getDistanceKm(lat, lng, location.lat, location.lng);
}

/** Accept very close POIs when the normalized name overlaps partially. */
function matchesByProximityAndPartialName(
  candidateName: string | undefined,
  expectedNames: string[],
  distanceKm: number
): boolean {
  if (distanceKm > TIGHT_MATCH_KM) return false;
  const candidate = normalizeBusinessName(candidateName ?? "");
  if (!candidate) return false;

  return expectedNames.some((expected) => {
    const norm = normalizeBusinessName(expected);
    if (norm.length < 3) return false;
    return candidate.includes(norm) || (candidate.length >= 3 && norm.includes(candidate));
  });
}

function scorePhotoCandidate(
  candidate: PhotoCandidate,
  expectedNames: string[],
  lat: number,
  lng: number
): number {
  const distanceKm = distanceKmFrom(lat, lng, candidate.location);
  if (distanceKm > MAX_MATCH_KM) return -1;

  if (matchesAnyExpectedName(candidate.name, expectedNames)) {
    return 100 - distanceKm * 100;
  }

  if (matchesByProximityAndPartialName(candidate.name, expectedNames, distanceKm)) {
    return 50 - distanceKm * 100;
  }

  return -1;
}

function pickBestPhotoCandidate(
  candidates: PhotoCandidate[],
  expectedNames: string[],
  lat: number,
  lng: number
): PhotoLookup {
  let best: { score: number; candidate: PhotoCandidate } | undefined;

  for (const candidate of candidates) {
    const score = scorePhotoCandidate(candidate, expectedNames, lat, lng);
    if (score < 0) continue;
    if (!best || score > best.score) {
      best = { score, candidate };
    }
  }

  if (!best) {
    const veryClose = candidates.filter(
      (candidate) =>
        candidate.refs.length > 0 &&
        distanceKmFrom(lat, lng, candidate.location) <= TIGHT_MATCH_KM
    );
    if (veryClose.length === 1) {
      return {
        placeId: veryClose[0].placeId,
        refs: veryClose[0].refs,
      };
    }
    const withPhotos = candidates.filter((candidate) => candidate.refs.length > 0);
    if (withPhotos.length === 1 && distanceKmFrom(lat, lng, withPhotos[0].location) <= MAX_MATCH_KM) {
      return {
        placeId: withPhotos[0].placeId,
        refs: withPhotos[0].refs,
      };
    }
    return { refs: [] };
  }
  return {
    placeId: best.candidate.placeId,
    refs: best.candidate.refs,
  };
}

function toPhotoCandidate(match: {
  place_id?: string;
  name?: string;
  photos?: GooglePhoto[];
  geometry?: { location?: GoogleLocation };
}): PhotoCandidate | null {
  if (!match.place_id) return null;
  return {
    placeId: match.place_id,
    name: match.name,
    refs: (match.photos ?? []).map((photo) => photo.photo_reference),
    location: match.geometry?.location,
  };
}

async function lookupPhotosByName(
  name: string,
  lat: number,
  lng: number,
  apiKey: string,
  expectedNames: string[],
  address?: string
): Promise<PhotoLookup> {
  const trimmedAddress = address?.trim();
  const searchQueries = [name, trimmedAddress ? `${name} ${trimmedAddress}` : undefined].filter(
    (value, index, all): value is string => !!value && all.indexOf(value) === index
  );
  const bias = `circle:${SEARCH_RADIUS_M}@${lat},${lng}`;
  const candidates: PhotoCandidate[] = [];

  for (const query of searchQueries) {
    const encodedQuery = encodeURIComponent(query);
    const findUrl =
      "https://maps.googleapis.com/maps/api/place/findplacefromtext/json?" +
      `input=${encodedQuery}&inputtype=textquery&fields=place_id,photos,geometry,name` +
      `&locationbias=${encodeURIComponent(bias)}&key=${apiKey}`;
    const findData = (await (await fetch(findUrl)).json()) as FindPlaceResponse;
    const findCandidate = toPhotoCandidate(findData.candidates?.[0] ?? {});
    if (findData.status === "OK" && findCandidate) {
      candidates.push(findCandidate);
    }

    const textUrl =
      "https://maps.googleapis.com/maps/api/place/textsearch/json?" +
      `query=${encodedQuery}&location=${lat},${lng}&radius=${SEARCH_RADIUS_M}&key=${apiKey}`;
    const textData = (await (await fetch(textUrl)).json()) as TextSearchResponse;
    for (const match of textData.results ?? []) {
      const candidate = toPhotoCandidate(match);
      if (candidate) candidates.push(candidate);
    }
  }

  const encodedName = encodeURIComponent(name);
  const nearbyUrl =
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json?" +
    `location=${lat},${lng}&radius=${SEARCH_RADIUS_M}&keyword=${encodedName}&key=${apiKey}`;
  const nearbyData = (await (await fetch(nearbyUrl)).json()) as NearbySearchResponse;
  for (const match of nearbyData.results ?? []) {
    const candidate = toPhotoCandidate(match);
    if (candidate) candidates.push(candidate);
  }

  const nearbyFoodUrl =
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json?" +
    `location=${lat},${lng}&radius=${SEARCH_RADIUS_M}&type=restaurant&key=${apiKey}`;
  const nearbyFoodData = (await (await fetch(nearbyFoodUrl)).json()) as NearbySearchResponse;
  for (const match of nearbyFoodData.results ?? []) {
    const candidate = toPhotoCandidate(match);
    if (candidate) candidates.push(candidate);
  }

  const deduped = [...new Map(candidates.map((item) => [item.placeId, item])).values()];
  const best = pickBestPhotoCandidate(deduped, expectedNames, lat, lng);
  if (best.placeId) return best;

  return { refs: [] };
}

export async function fetchGooglePlacePhotoRefs(
  name: string,
  lat: number,
  lng: number,
  apiKey: string,
  altName?: string,
  address?: string
): Promise<{ placeId?: string; refs: string[] }> {
  const names = [name, altName]
    .map((value) => value?.trim())
    .filter((value, index, all): value is string => !!value && all.indexOf(value) === index);

  let placeId: string | undefined;
  let refs: string[] = [];
  const expectedNames = names;

  for (const queryName of names) {
    const found = await lookupPhotosByName(
      queryName,
      lat,
      lng,
      apiKey,
      expectedNames,
      address
    );
    if (found.placeId) {
      placeId = found.placeId;
      refs = found.refs;
      if (refs.length > 0) break;
    }
  }

  if (placeId && refs.length < 3) {
    const detailsUrl =
      "https://maps.googleapis.com/maps/api/place/details/json?" +
      `place_id=${placeId}&fields=photos&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    const detailsData = (await detailsRes.json()) as PlaceDetailsResponse;

    if (detailsData.status === "OK" && detailsData.result?.photos?.length) {
      refs = detailsData.result.photos.map((photo) => photo.photo_reference);
    }
  }

  return { placeId, refs: refs.slice(0, 5) };
}

/** Resolve the Google place_id and photo refs for a business (name-verified). */
export async function resolveGooglePlacePhotos(options: {
  apiKey: string;
  nameHe: string;
  nameEn?: string | null;
  lat: number;
  lng: number;
  googlePlaceId?: string | null;
  address?: string | null;
}): Promise<{ googlePlaceId?: string; refs: string[] }> {
  const { apiKey, nameHe, nameEn, lat, lng, googlePlaceId, address } = options;
  const realGooglePlaceId = isRealGooglePlaceId(googlePlaceId) ? googlePlaceId!.trim() : undefined;

  if (realGooglePlaceId) {
    const refs = await fetchGooglePlacePhotoRefsByPlaceId(realGooglePlaceId, apiKey);
    if (refs.length > 0) {
      return { googlePlaceId: realGooglePlaceId, refs };
    }
  }

  const resolved = await fetchGooglePlacePhotoRefs(
    nameHe,
    lat,
    lng,
    apiKey,
    nameEn ?? undefined,
    address ?? undefined
  );
  return { googlePlaceId: resolved.placeId, refs: resolved.refs };
}

export function isRealGooglePlaceId(placeId: string | null | undefined): boolean {
  if (!placeId) return false;
  return !placeId.startsWith("osm:") && !placeId.startsWith("photon:");
}

/** Fetch fresh photo refs from Place Details when googlePlaceId is known. */
export async function fetchGooglePlacePhotoRefsByPlaceId(
  googlePlaceId: string,
  apiKey: string
): Promise<string[]> {
  const detailsUrl =
    "https://maps.googleapis.com/maps/api/place/details/json?" +
    `place_id=${encodeURIComponent(googlePlaceId)}&fields=photos&key=${apiKey}`;
  const detailsRes = await fetch(detailsUrl);
  if (!detailsRes.ok) return [];
  const detailsData = (await detailsRes.json()) as PlaceDetailsResponse;
  if (detailsData.status !== "OK" || !detailsData.result?.photos?.length) return [];
  return detailsData.result.photos.map((photo) => photo.photo_reference).slice(0, 5);
}

/**
 * Fetch opening hours from Google Place Details for a known place_id.
 */
export async function fetchGoogleOpeningHoursByPlaceId(
  placeId: string,
  apiKey: string
): Promise<OpeningHoursMap | null> {
  const detailsUrl =
    "https://maps.googleapis.com/maps/api/place/details/json?" +
    `place_id=${encodeURIComponent(placeId)}&fields=opening_hours&language=he&key=${apiKey}`;
  const detailsRes = await fetch(detailsUrl);
  if (!detailsRes.ok) return null;
  const detailsData = (await detailsRes.json()) as PlaceDetailsResponse;
  if (detailsData.status !== "OK") return null;
  return normalizeGoogleOpeningHours(detailsData.result?.opening_hours);
}

/**
 * Resolve Google place_id (if needed) then return normalized opening hours.
 */
export async function fetchGoogleOpeningHoursForBusiness(options: {
  apiKey: string;
  googlePlaceId?: string | null;
  name: string;
  altName?: string | null;
  lat: number;
  lng: number;
}): Promise<{ hours: OpeningHoursMap | null; googlePlaceId?: string }> {
  const { apiKey, name, altName, lat, lng } = options;
  let placeId = isRealGooglePlaceId(options.googlePlaceId)
    ? options.googlePlaceId!.trim()
    : undefined;

  if (!placeId) {
    const names = [name, altName]
      .map((value) => value?.trim())
      .filter((value, index, all): value is string => !!value && all.indexOf(value) === index);

    for (const queryName of names) {
      const found = await lookupPhotosByName(queryName, lat, lng, apiKey, names);
      if (found.placeId) {
        placeId = found.placeId;
        break;
      }
    }
  }

  if (!placeId) return { hours: null };

  const hours = await fetchGoogleOpeningHoursByPlaceId(placeId, apiKey);
  return { hours, googlePlaceId: placeId };
}

export const googlePlacesSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
