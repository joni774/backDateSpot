/**
 * One-shot: upload existing place images to Cloudinary and replace DB URLs.
 *
 * Usage (from datespot-server root, with DATABASE_URL + Cloudinary env set):
 *   pnpm --filter @datespot/database exec tsx ../places-logic/scripts/migrate-images-to-cloudinary.ts
 * Or:
 *   cd packages/places-logic && pnpm exec tsx scripts/migrate-images-to-cloudinary.ts
 *
 * Requires Cloudinary env vars. Google key optional (needed to materialize gpl: refs).
 */
import { prisma } from "@datespot/database";
import {
  isCloudinaryUrl,
  materializeImagesToCloudinary,
  needsGooglePhoto,
} from "../src/place-image-sources";

async function main() {
  const places = await prisma.place.findMany({
    orderBy: { id: "asc" },
    select: { id: true, nameHe: true, images: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const place of places) {
    if (!needsGooglePhoto(place.images) && place.images.some(isCloudinaryUrl)) {
      skipped += 1;
      continue;
    }
    if (place.images.length === 0) {
      skipped += 1;
      continue;
    }

    const next = await materializeImagesToCloudinary(place.id, place.images);
    const changed =
      next.length !== place.images.length ||
      next.some((url, i) => url !== place.images[i]) ||
      next.some(isCloudinaryUrl);

    if (!changed || !next.some(isCloudinaryUrl)) {
      skipped += 1;
      continue;
    }

    await prisma.place.update({
      where: { id: place.id },
      data: { images: next },
    });
    updated += 1;
    console.log(`updated ${place.nameHe} → ${next.filter(isCloudinaryUrl).length} cloudinary url(s)`);
  }

  console.log(`done: updated=${updated} skipped=${skipped} total=${places.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
