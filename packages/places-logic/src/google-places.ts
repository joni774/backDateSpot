const GOOGLE_PHOTO_PREFIX = "gpl:";

type GooglePhoto = { photo_reference: string };

type FindPlaceResponse = {
  status: string;
  candidates?: Array<{ place_id?: string; photos?: GooglePhoto[] }>;
};

type PlaceDetailsResponse = {
  status: string;
  result?: { photos?: GooglePhoto[] };
};

type NearbySearchResponse = {
  status: string;
  results?: Array<{ place_id?: string; photos?: GooglePhoto[] }>;
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

export async function fetchGooglePlacePhotoRefs(
  name: string,
  lat: number,
  lng: number,
  apiKey: string
): Promise<string[]> {
  const encodedName = encodeURIComponent(name);
  const bias = `circle:300@${lat},${lng}`;

  const findUrl =
    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json?" +
    `input=${encodedName}&inputtype=textquery&fields=place_id,photos` +
    `&locationbias=${encodeURIComponent(bias)}&key=${apiKey}`;

  const findRes = await fetch(findUrl);
  const findData = (await findRes.json()) as FindPlaceResponse;

  let placeId: string | undefined;
  let refs: string[] = [];

  if (findData.status === "OK" && findData.candidates?.[0]) {
    const candidate = findData.candidates[0];
    placeId = candidate.place_id;
    refs = (candidate.photos ?? []).map((photo) => photo.photo_reference);
  }

  if (refs.length === 0) {
    const nearbyUrl =
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json?" +
      `location=${lat},${lng}&radius=150&keyword=${encodedName}&key=${apiKey}`;
    const nearbyRes = await fetch(nearbyUrl);
    const nearbyData = (await nearbyRes.json()) as NearbySearchResponse;

    if (nearbyData.status === "OK" && nearbyData.results?.[0]) {
      const match = nearbyData.results[0];
      placeId = match.place_id;
      refs = (match.photos ?? []).map((photo) => photo.photo_reference);
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
