/**
 * Fetch unique photos for each place (Google Places if configured, otherwise OSM/Wikimedia).
 *
 * Usage:
 *   npx tsx scripts/enrich-place-photos.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  fallbackUniqueImage,
  fetchPlaceImages,
  imageFetchSleep,
  isGenericPlaceholder,
} from "../../places-logic/src/place-image-sources";
import { getGooglePlacesApiKey } from "../../places-logic/src/google-places";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const prisma = new PrismaClient();

async function main() {
  const googleKey = getGooglePlacesApiKey();
  console.log(
    googleKey
      ? "Using Google Places + free fallbacks"
      : "No Google key — using OSM / Wikimedia (free, no signup)"
  );

  const places = await prisma.place.findMany({ orderBy: { displayOrder: "asc" } });
  const toUpdate = places.filter((place) => isGenericPlaceholder(place.images));

  console.log(`Found ${places.length} places, ${toUpdate.length} need unique photos`);

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
      });

      if (images.length === 0) {
        const fallback = fallbackUniqueImage(place.id);
        await prisma.place.update({
          where: { id: place.id },
          data: { images: [fallback] },
        });
        updated += 1;
        console.log(`Fallback image for ${place.nameHe}`);
        await imageFetchSleep(1100);
        continue;
      }

      await prisma.place.update({
        where: { id: place.id },
        data: { images },
      });

      updated += 1;
      const preview = images[0].startsWith("gpl:")
        ? "Google Places"
        : images[0].slice(0, 70);
      console.log(`Updated ${place.nameHe} → ${preview}`);
      await imageFetchSleep(1100);
    } catch (err) {
      console.warn(`Failed for ${place.nameHe}:`, err);
      skipped += 1;
      await imageFetchSleep(1100);
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
