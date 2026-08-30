import { getDistanceKm } from "@datespot/utils";
import {
  normalizeGoogleOpeningHours,
  type GoogleOpeningHours,
  type OpeningHoursMap,
} from "./utils/opening-hours";

const GOOGLE_PHOTO_PREFIX = "gpl:";
/** Reject Google matches that are clearly a different nearby business. */
const MAX_MATCH_KM = 0.12;

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
    photos?: GooglePhoto[];
    geometry?: { location?: GoogleLocation };
  }>;
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

/** True for stable http(s) URLs we can return to clients as-is (not encoded Google refs). */
export function isDirectImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return false;
  return decodeGooglePhotoRef(trimmed) === null;
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

function isSameSpot(lat: number, lng: number, location?: GoogleLocation): boolean {
  if (location?.lat == null || location?.lng == null) return true;
  return getDistanceKm(lat, lng, location.lat, location.lng) <= MAX_MATCH_KM;
}

async function lookupPhotosByName(
  name: string,
  lat: number,
  lng: number,
  apiKey: string
): Promise<PhotoLookup> {
  const encodedName = encodeURIComponent(name);
  const bias = `circle:120@${lat},${lng}`;
  const findUrl =
    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json?" +
    `input=${encodedName}&inputtype=textquery&fields=place_id,photos,geometry,name` +
    `&locationbias=${encodeURIComponent(bias)}&key=${apiKey}`;

  const findRes = await fetch(findUrl);
  const findData = (await findRes.json()) as FindPlaceResponse;
  const candidate = findData.candidates?.[0];
  if (findData.status === "OK" && candidate?.place_id && isSameSpot(lat, lng, candidate.geometry?.location)) {
    return {
      placeId: candidate.place_id,
      refs: (candidate.photos ?? []).map((photo) => photo.photo_reference),
    };
  }

  const nearbyUrl =
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json?" +
    `location=${lat},${lng}&radius=80&keyword=${encodedName}&key=${apiKey}`;
  const nearbyRes = await fetch(nearbyUrl);
  const nearbyData = (await nearbyRes.json()) as NearbySearchResponse;
  const match = nearbyData.results?.[0];
  if (nearbyData.status === "OK" && match?.place_id && isSameSpot(lat, lng, match.geometry?.location)) {
    return {
      placeId: match.place_id,
      refs: (match.photos ?? []).map((photo) => photo.photo_reference),
    };
  }

  return { refs: [] };
}

export async function fetchGooglePlacePhotoRefs(
  name: string,
  lat: number,
  lng: number,
  apiKey: string,
  altName?: string
): Promise<string[]> {
  const names = [name, altName]
    .map((value) => value?.trim())
    .filter((value, index, all): value is string => !!value && all.indexOf(value) === index);

  let placeId: string | undefined;
  let refs: string[] = [];

  for (const queryName of names) {
    const found = await lookupPhotosByName(queryName, lat, lng, apiKey);
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

  return refs.slice(0, 5);
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
      const found = await lookupPhotosByName(queryName, lat, lng, apiKey);
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
