/**
 * Replace stock/empty images with Google Places photos of that business.
 * Prefers Google; only keeps stock when Google has no match.
 *
 * Usage:
 *   pnpm db:restore-photos
 */
import { PrismaClient } from "@prisma/client";
import {
  fetchPlaceImages,
  imageFetchSleep,
  isGenericPlaceholder,
  needsGooglePhoto,
} from "../../places-logic/src/place-image-sources";
import { getGooglePlacesApiKey } from "../../places-logic/src/google-places";
import { stockImageForCategory } from "../../places-logic/src/place-photo-serve";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const prisma = new PrismaClient();

async function main() {
  const googleKey = getGooglePlacesApiKey();
  if (!googleKey) {
    console.error(
      "GOOGLE_PLACES_API_KEY is missing. Add a Google Places API key and retry."
    );
    process.exit(1);
  }

  const places = await prisma.place.findMany({ orderBy: { id: "asc" } });
  const toFix = places.filter(
    (place) => place.images.length === 0 || isGenericPlaceholder(place.images)
  );

  console.log(`Found ${places.length} places, ${toFix.length} need real photos`);

  let updated = 0;
  let stockFallback = 0;
  let skipped = 0;

  for (const place of toFix) {
    try {
      const images = await fetchPlaceImages({
        nameHe: place.nameHe,
        nameEn: place.nameEn,
        category: place.category,
        latitude: place.latitude,
        longitude: place.longitude,
        address: place.address,
        googlePlaceId: place.googlePlaceId,
      });

      if (images.length === 0) {
        if (place.images.length === 0) {
          await prisma.place.update({
            where: { id: place.id },
            data: { images: [stockImageForCategory(place.category)] },
          });
          stockFallback += 1;
        } else {
          skipped += 1;
        }
        await imageFetchSleep(250);
        continue;
      }

      await prisma.place.update({
        where: { id: place.id },
        data: { images },
      });
      updated += 1;
      console.log(`Google photo → ${place.nameHe}`);
      await imageFetchSleep(250);
    } catch (err) {
      console.warn(`Failed for ${place.nameHe}:`, err);
      skipped += 1;
      await imageFetchSleep(250);
    }
  }

  console.log(
    `Done. Google updated ${updated}, stock fallback ${stockFallback}, skipped ${skipped}.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
