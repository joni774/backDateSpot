/**
 * Replace stock/empty images with Google Places photos of that business.
 *
 * Requires GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY.
 *
 * Usage:
 *   pnpm db:enrich-photos
 */
import { PrismaClient } from "@prisma/client";
import {
  fetchPlaceImages,
  imageFetchSleep,
  needsGooglePhoto,
} from "../../places-logic/src/place-image-sources";
import { getGooglePlacesApiKey } from "../../places-logic/src/google-places";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const prisma = new PrismaClient();

async function main() {
  const googleKey = getGooglePlacesApiKey();
  if (!googleKey) {
    console.error(
      "GOOGLE_PLACES_API_KEY is missing. Add a Google Places API key (Place Photos enabled) and retry."
    );
    process.exit(1);
  }

  console.log("Fetching original Google photos for each place...");

  const places = await prisma.place.findMany({ orderBy: { displayOrder: "asc" } });
  const toUpdate = places.filter((place) => needsGooglePhoto(place.images));

  console.log(`Found ${places.length} places, ${toUpdate.length} need Google photos`);

  let updated = 0;
  let skipped = 0;

  for (const place of toUpdate) {
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
        skipped += 1;
        console.log(`No Google photo for ${place.nameHe}`);
        await imageFetchSleep(250);
        continue;
      }

      await prisma.place.update({
        where: { id: place.id },
        data: { images },
      });

      updated += 1;
      console.log(`Updated ${place.nameHe} → Google Places`);
      await imageFetchSleep(250);
    } catch (err) {
      console.warn(`Failed for ${place.nameHe}:`, err);
      skipped += 1;
      await imageFetchSleep(250);
    }
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
