import { getDistanceKm } from "@datespot/utils";
import {
  normalizeGoogleOpeningHours,
  type GoogleOpeningHours,
  type OpeningHoursMap,
} from "./utils/opening-hours";

const GOOGLE_PHOTO_PREFIX = "gpl:";
/** Reject Google matches that are clearly a different nearby business. */
const MAX_MATCH_KM = 0.35;
/** Within this distance, accept a partial name match (OSM coords are often offset). */
const TIGHT_MATCH_KM = 0.1;
const SEARCH_RADIUS_M = 250;
/** Minimum fuzzy name score (0–40) to accept a nearby POI for OSM-imported rows. */
const MIN_FUZZY_SCORE = 22;

const NEARBY_FOOD_TYPES = ["restaurant", "cafe", "bar", "bakery", "meal_takeaway"] as const;

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

/** Strip common Hebrew/English venue prefixes OSM rows often include. */
export function stripBusinessNameNoise(name: string): string {
  let value = name.trim();
  const prefixes = [
    /^מסעד[תה]\s+/u,
    /^בית\s+קפה\s+/u,
    /^בית\s+קafe\s+/iu,
    /^קafe\s+/iu,
    /^restaurant\s+/iu,
    /^cafe\s+/iu,
    /^bar\s+/iu,
    /^pub\s+/iu,
    /^pizzeria\s+/iu,
    /^פיצרי[הה]\s+/u,
    /^סushi\s+/iu,
    /^סושי\s+/u,
    /^burger\s+/iu,
    /^בургר\s+/u,
  ];
  for (const prefix of prefixes) {
    value = value.replace(prefix, "");
  }
  value = value.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  return value.replace(/\s+/g, " ").trim();
}

/** Build deduped name/address variants for Google text & nearby search. */
export function expandExpectedNames(
  nameHe: string,
  nameEn?: string | null,
  address?: string | null
): string[] {
  const variants = new Set<string>();
  const he = nameHe.trim();
  const en = nameEn?.trim() ?? "";
  const strippedHe = stripBusinessNameNoise(he);
  const strippedEn = stripBusinessNameNoise(en);

  for (const value of [he, en, strippedHe, strippedEn]) {
    if (value.length >= 2) variants.add(value);
  }

  for (const raw of [he, en, strippedHe, strippedEn]) {
    const tokens = normalizeBusinessName(raw)
      .split(/\s+/)
      .filter((token) => token.length >= 3);
    if (tokens[0]) variants.add(tokens[0]);
    if (tokens.length >= 2) variants.add(tokens.slice(0, 2).join(" "));
  }

  const city =
    address
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .pop() ?? address?.split(/\s+/).pop();
  if (city && city.length >= 2) {
    if (strippedHe) variants.add(`${strippedHe} ${city}`);
    if (he) variants.add(`${he} ${city}`);
    if (strippedEn) variants.add(`${strippedEn} ${city}`);
  }

  return [...variants];
}

function fuzzyNameScore(expectedNames: string[], candidateName: string | undefined): number {
  if (!candidateName?.trim()) return 0;
  const candidate = normalizeBusinessName(candidateName);
  const candidateTokens = candidate.split(/\s+/).filter((token) => token.length >= 2);
  if (candidateTokens.length === 0) return 0;

  let best = 0;
  const candidateTokenSet = new Set(candidateTokens);

  for (const expected of expectedNames) {
    const variants = [expected, stripBusinessNameNoise(expected)];
    for (const raw of variants) {
      const norm = normalizeBusinessName(raw);
      if (!norm) continue;
      if (candidate === norm) best = Math.max(best, 40);
      if (candidate.includes(norm) || norm.includes(candidate)) best = Math.max(best, 35);

      const expectedTokens = norm.split(/\s+/).filter((token) => token.length >= 2);
      const overlap = expectedTokens.filter((token) => candidateTokenSet.has(token)).length;
      const minLen = Math.min(expectedTokens.length, candidateTokens.length);
      if (minLen > 0 && overlap > 0) {
        best = Math.max(best, (overlap / minLen) * 32);
      }
      for (const token of expectedTokens) {
        if (token.length >= 4 && candidateTokenSet.has(token)) {
          best = Math.max(best, 26);
        }
      }
    }
  }

  return best;
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

  const fuzzy = fuzzyNameScore(expectedNames, candidate.name);
  if (fuzzy >= MIN_FUZZY_SCORE) {
    return fuzzy - distanceKm * 80;
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

  if (best && best.score >= MIN_FUZZY_SCORE) {
    return {
      placeId: best.candidate.placeId,
      refs: best.candidate.refs,
    };
  }

  const nearbyScored = candidates
    .map((candidate) => ({
      candidate,
      distanceKm: distanceKmFrom(lat, lng, candidate.location),
      fuzzy: fuzzyNameScore(expectedNames, candidate.name),
    }))
    .filter(
      (entry) =>
        entry.distanceKm <= TIGHT_MATCH_KM &&
        entry.fuzzy >= MIN_FUZZY_SCORE
    )
    .sort((a, b) => b.fuzzy - a.fuzzy - (a.distanceKm - b.distanceKm) * 10);

  if (nearbyScored[0]) {
    return {
      placeId: nearbyScored[0].candidate.placeId,
      refs: nearbyScored[0].candidate.refs,
    };
  }

  const veryClose = candidates.filter(
    (candidate) => distanceKmFrom(lat, lng, candidate.location) <= TIGHT_MATCH_KM
  );
  if (veryClose.length === 1) {
    return {
      placeId: veryClose[0].placeId,
      refs: veryClose[0].refs,
    };
  }

  return { refs: [] };
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
  const searchQueries = [
    name,
    ...expectedNames,
    trimmedAddress ? `${name} ${trimmedAddress}` : undefined,
    trimmedAddress ? `${stripBusinessNameNoise(name)} ${trimmedAddress}` : undefined,
  ].filter((value, index, all): value is string => !!value && all.indexOf(value) === index);

  const bias = `circle:${SEARCH_RADIUS_M}@${lat},${lng}`;
  const candidates: PhotoCandidate[] = [];

  for (const query of searchQueries.slice(0, 8)) {
    const encodedQuery = encodeURIComponent(query);
    const findUrl =
      "https://maps.googleapis.com/maps/api/place/findplacefromtext/json?" +
      `input=${encodedQuery}&inputtype=textquery&fields=place_id,photos,geometry,name` +
      `&locationbias=${encodeURIComponent(bias)}&key=${apiKey}`;
    const findData = (await (await fetch(findUrl)).json()) as FindPlaceResponse;
    for (const match of findData.candidates ?? []) {
      const findCandidate = toPhotoCandidate(match);
      if (findData.status === "OK" && findCandidate) {
        candidates.push(findCandidate);
      }
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

  for (const query of searchQueries.slice(0, 4)) {
    const encodedName = encodeURIComponent(query);
    const nearbyUrl =
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json?" +
      `location=${lat},${lng}&radius=${SEARCH_RADIUS_M}&keyword=${encodedName}&key=${apiKey}`;
    const nearbyData = (await (await fetch(nearbyUrl)).json()) as NearbySearchResponse;
    for (const match of nearbyData.results ?? []) {
      const candidate = toPhotoCandidate(match);
      if (candidate) candidates.push(candidate);
    }
  }

  for (const nearbyType of NEARBY_FOOD_TYPES) {
    const nearbyFoodUrl =
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json?" +
      `location=${lat},${lng}&radius=${SEARCH_RADIUS_M}&type=${nearbyType}&key=${apiKey}`;
    const nearbyFoodData = (await (await fetch(nearbyFoodUrl)).json()) as NearbySearchResponse;
    for (const match of nearbyFoodData.results ?? []) {
      const candidate = toPhotoCandidate(match);
      if (candidate) candidates.push(candidate);
    }
  }

  const deduped = [...new Map(candidates.map((item) => [item.placeId, item])).values()];
  const best = pickBestPhotoCandidate(deduped, expectedNames, lat, lng);
  if (!best.placeId) return { refs: [] };

  let refs = best.refs;
  if (refs.length === 0) {
    refs = await fetchGooglePlacePhotoRefsByPlaceId(best.placeId, apiKey);
  }

  return { placeId: best.placeId, refs };
}

export async function fetchGooglePlacePhotoRefs(
  name: string,
  lat: number,
  lng: number,
  apiKey: string,
  altName?: string,
  address?: string
): Promise<{ placeId?: string; refs: string[] }> {
  const expectedNames = expandExpectedNames(name, altName, address);
  const queryNames = expectedNames.length > 0 ? expectedNames : [name];

  let placeId: string | undefined;
  let refs: string[] = [];

  for (const queryName of queryNames) {
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
      break;
    }
  }

  if (placeId && refs.length < 3) {
    const detailRefs = await fetchGooglePlacePhotoRefsByPlaceId(placeId, apiKey);
    if (detailRefs.length > 0) refs = detailRefs;
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
    const expectedNames = expandExpectedNames(name, altName, undefined);
    const queryNames = expectedNames.length > 0 ? expectedNames : [name];

    for (const queryName of queryNames) {
      const found = await lookupPhotosByName(queryName, lat, lng, apiKey, expectedNames);
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
