import { getDistanceKm } from "@datespot/utils";

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
  result?: { photos?: GooglePhoto[] };
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

export function resolvePlaceImageUrls(images: string[], baseUrl: string): string[] {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  return images.map((image) => {
    const ref = decodeGooglePhotoRef(image);
    if (!ref) return image;
    return `${normalizedBase}/api/places/photo?ref=${encodeURIComponent(ref)}`;
  });
}

export function buildGooglePhotoFetchUrl(ref: string, apiKey: string): string {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${encodeURIComponent(ref)}&key=${apiKey}`;
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

export const googlePlacesSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
