import { type Place, type PlaceCategory } from "@datespot/database";
import type { Response } from "express";
import {
  isCloudinaryConfigured,
  uploadPlaceImageBuffer,
} from "./cloudinary-storage";
import {
  encodeGooglePhotoRef,
  fetchGooglePhotoBuffer,
  fetchGooglePlacePhotoRefsByPlaceId,
  decodeGooglePhotoRef,
  isDirectImageUrl,
  isRealGooglePlaceId,
  resolveGooglePlacePhotos,
} from "./google-places";
import {
  fetchPlaceImages,
  fallbackUniqueImage,
  FOOD_CATEGORIES,
  isGenericPlaceholder,
  persistPlacePhotoCache,
} from "./place-image-sources";

const CATEGORY_STOCK_IMAGE: Record<PlaceCategory, string> = {
  ROMANTIC_DATE: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800",
  RESTAURANT: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800",
  DAIRY_RESTAURANT: "https://images.unsplash.com/photo-1558030006-450675393462?w=800",
  MEAT_RESTAURANT: "https://images.unsplash.com/photo-1544025162-d76694265947?w=800",
  SUSHI: "https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=800",
  SUNSET: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800",
  ATTRACTION: "https://images.unsplash.com/photo-1488459716781-31db71592aa9?w=800",
};

function storedGoogleRefs(place: Place): string[] {
  return place.images
    .map((image) => decodeGooglePhotoRef(image))
    .filter((ref): ref is string => !!ref);
}

async function resolveFreshGoogleRefs(
  place: Place,
  apiKey: string
): Promise<{ refs: string[]; googlePlaceId?: string }> {
  const resolved = await resolveGooglePlacePhotos({
    apiKey,
    nameHe: place.nameHe,
    nameEn: place.nameEn,
    lat: place.latitude,
    lng: place.longitude,
    googlePlaceId: place.googlePlaceId,
    address: place.address,
  });
  return { refs: resolved.refs, googlePlaceId: resolved.googlePlaceId };
}

async function sendImageBuffer(
  res: Response,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "public, max-age=3600");
  res.send(buffer);
}

async function proxyExternalImage(res: Response, url: string): Promise<boolean> {
  try {
    const imageRes = await fetch(url, { redirect: "follow" });
    if (!imageRes.ok) return false;
    await sendImageBuffer(
      res,
      Buffer.from(await imageRes.arrayBuffer()),
      imageRes.headers.get("content-type") ?? "image/jpeg"
    );
    return true;
  } catch {
    return false;
  }
}

function categoryStockImage(place: Place): string {
  return CATEGORY_STOCK_IMAGE[place.category] ?? fallbackUniqueImage(place.id);
}

async function serveGoogleRef(
  res: Response,
  ref: string,
  apiKey: string,
  persist?: { placeId: string; index: number }
): Promise<boolean> {
  const photo = await fetchGooglePhotoBuffer(ref, apiKey);
  if (!photo) return false;
  await sendImageBuffer(res, photo.buffer, photo.contentType);

  if (persist && isCloudinaryConfigured()) {
    void uploadPlaceImageBuffer({
      placeId: persist.placeId,
      index: persist.index,
      buffer: photo.buffer,
      contentType: photo.contentType,
    })
      .then((url) => {
        if (!url) return;
        return persistPlacePhotoCache({
          placeId: persist.placeId,
          images: [url],
        });
      })
      .catch((err) => {
        console.warn(`[places] cloudinary persist failed for ${persist.placeId}:`, err);
      });
  }

  return true;
}

async function serveImageCandidate(
  res: Response,
  candidate: string | undefined,
  apiKey?: string
): Promise<boolean> {
  if (!candidate) return false;
  const gplRef = decodeGooglePhotoRef(candidate);
  if (gplRef && apiKey) {
    return serveGoogleRef(res, gplRef, apiKey);
  }
  if (isDirectImageUrl(candidate)) {
    return proxyExternalImage(res, candidate);
  }
  return false;
}

async function serveGoogleRefAtIndex(
  res: Response,
  place: Place,
  index: number,
  apiKey: string,
  refs: string[]
): Promise<boolean> {
  const storedRef = refs[index] ?? refs[0];
  if (!storedRef) return false;
  return serveGoogleRef(res, storedRef, apiKey, {
    placeId: place.id,
    index,
  });
}

async function serveFallbackImages(res: Response, place: Place): Promise<void> {
  if (FOOD_CATEGORIES.has(place.category)) return;
  if (await proxyExternalImage(res, categoryStockImage(place))) return;
  await proxyExternalImage(res, fallbackUniqueImage(place.id));
}

/** Serve a place photo by index, refreshing expired Google refs when needed. */
export async function servePlacePhotoByIndex(options: {
  res: Response;
  place: Place;
  index: number;
  apiKey?: string;
}): Promise<void> {
  const { res, place, index, apiKey } = options;

  try {
    const direct = place.images.filter(isDirectImageUrl);
    const directUrl = direct[index] ?? direct[0];
    if (await serveImageCandidate(res, directUrl, apiKey)) return;

    const storedRefs = storedGoogleRefs(place);
    if (apiKey) {
      if (await serveGoogleRefAtIndex(res, place, index, apiKey, storedRefs)) return;

      const realGooglePlaceId = isRealGooglePlaceId(place.googlePlaceId)
        ? place.googlePlaceId!.trim()
        : undefined;
      if (realGooglePlaceId) {
        const refs = await fetchGooglePlacePhotoRefsByPlaceId(realGooglePlaceId, apiKey);
        if (await serveGoogleRefAtIndex(res, place, index, apiKey, refs)) {
          void persistPlacePhotoCache({
            placeId: place.id,
            images: refs.map(encodeGooglePhotoRef),
            googlePlaceId: realGooglePlaceId,
          }).catch((err) => {
            console.warn(`[places] photo cache update failed for ${place.nameHe}:`, err);
          });
          return;
        }
      }

      const fresh = await resolveFreshGoogleRefs(place, apiKey);
      if (await serveGoogleRefAtIndex(res, place, index, apiKey, fresh.refs)) {
        void persistPlacePhotoCache({
          placeId: place.id,
          images: fresh.refs.map(encodeGooglePhotoRef),
          googlePlaceId: fresh.googlePlaceId,
        }).catch((err) => {
          console.warn(`[places] photo cache update failed for ${place.nameHe}:`, err);
        });
        return;
      }
    }

    const fetched = await fetchPlaceImages({
      nameHe: place.nameHe,
      nameEn: place.nameEn,
      category: place.category,
      latitude: place.latitude,
      longitude: place.longitude,
      address: place.address,
      googlePlaceId: isRealGooglePlaceId(place.googlePlaceId) ? place.googlePlaceId : null,
    });
    const fetchedCandidate = fetched.images[index] ?? fetched.images[0];
    if (await serveImageCandidate(res, fetchedCandidate, apiKey)) {
      if (
        place.images.length === 0 ||
        isGenericPlaceholder(place.images) ||
        storedRefs.length > 0
      ) {
        void persistPlacePhotoCache({
          placeId: place.id,
          images: fetched.images,
          googlePlaceId: fetched.googlePlaceId,
        }).catch(() => undefined);
      }
      return;
    }

    if (!FOOD_CATEGORIES.has(place.category)) {
      await serveFallbackImages(res, place);
    }
  } catch (err) {
    console.warn(`[places] photo serve failed for ${place.nameHe}:`, err);
    if (!res.headersSent && !FOOD_CATEGORIES.has(place.category)) {
      await serveFallbackImages(res, place).catch(() => undefined);
    }
  }

  if (!res.headersSent) {
    res.status(404).json({ error: "Place photo unavailable" });
  }
}

export function stockImageForCategory(category: PlaceCategory): string {
  return CATEGORY_STOCK_IMAGE[category] ?? "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=800";
}
