import { prisma, type Place, type PlaceCategory } from "@datespot/database";
import type { Response } from "express";
import {
  encodeGooglePhotoRef,
  fetchGooglePhotoBuffer,
  fetchGooglePlacePhotoRefs,
  fetchGooglePlacePhotoRefsByPlaceId,
  isRealGooglePlaceId,
  decodeGooglePhotoRef,
  isDirectImageUrl,
} from "./google-places";
import { fetchPlaceImages, fallbackUniqueImage } from "./place-image-sources";

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
): Promise<string[]> {
  if (isRealGooglePlaceId(place.googlePlaceId)) {
    const byId = await fetchGooglePlacePhotoRefsByPlaceId(place.googlePlaceId!, apiKey);
    if (byId.length > 0) return byId;
  }
  return fetchGooglePlacePhotoRefs(
    place.nameHe,
    place.latitude,
    place.longitude,
    apiKey,
    place.nameEn
  );
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

/** Serve a place photo by index, refreshing expired Google refs when needed. */
export async function servePlacePhotoByIndex(options: {
  res: Response;
  place: Place;
  index: number;
  apiKey?: string;
}): Promise<void> {
  const { res, place, index, apiKey } = options;
  const direct = place.images.filter(isDirectImageUrl);
  const directUrl = direct[index] ?? direct[0];
  if (directUrl) {
    if (await proxyExternalImage(res, directUrl)) return;
  }

  const storedRefs = storedGoogleRefs(place);
  if (apiKey) {
    const storedRef = storedRefs[index] ?? storedRefs[0];
    if (storedRef) {
      const cached = await fetchGooglePhotoBuffer(storedRef, apiKey);
      if (cached) {
        await sendImageBuffer(res, cached.buffer, cached.contentType);
        return;
      }
    }

    const freshRefs = await resolveFreshGoogleRefs(place, apiKey);
    const freshRef = freshRefs[index] ?? freshRefs[0];
    if (freshRef) {
      const fresh = await fetchGooglePhotoBuffer(freshRef, apiKey);
      if (fresh) {
        void prisma.place
          .update({
            where: { id: place.id },
            data: { images: freshRefs.map(encodeGooglePhotoRef) },
          })
          .catch((err) => {
            console.warn(`[places] photo cache update failed for ${place.nameHe}:`, err);
          });
        await sendImageBuffer(res, fresh.buffer, fresh.contentType);
        return;
      }
    }
  }

  const fetched = await fetchPlaceImages({
    nameHe: place.nameHe,
    nameEn: place.nameEn,
    category: place.category,
    latitude: place.latitude,
    longitude: place.longitude,
    address: place.address,
  });
  const fetchedUrl = fetched[index] ?? fetched[0];
  if (fetchedUrl && (await proxyExternalImage(res, fetchedUrl))) {
    if (place.images.length === 0) {
      void prisma.place
        .update({ where: { id: place.id }, data: { images: fetched } })
        .catch(() => undefined);
    }
    return;
  }

  await proxyExternalImage(res, categoryStockImage(place)).catch(() => undefined);
  if (!res.headersSent) {
    await proxyExternalImage(res, fallbackUniqueImage(place.id)).catch(() => undefined);
  }
  if (!res.headersSent) {
    res.status(404).json({ error: "Place photo unavailable" });
  }
}

export function stockImageForCategory(category: PlaceCategory): string {
  return CATEGORY_STOCK_IMAGE[category] ?? "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=800";
}
