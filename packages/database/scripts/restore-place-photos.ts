/**
 * Backfill empty place images with category stock photos (Unsplash).
 *
 * Usage:
 *   pnpm db:restore-photos
 */
import { PrismaClient } from "@prisma/client";
import { stockImageForCategory } from "../../places-logic/src/place-photo-serve";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const prisma = new PrismaClient();

async function main() {
  const places = await prisma.place.findMany({ orderBy: { id: "asc" } });
  const empty = places.filter((place) => place.images.length === 0);

  console.log(`Found ${places.length} places, ${empty.length} with empty images`);

  let updated = 0;
  for (const place of empty) {
    const images = [stockImageForCategory(place.category)];
    await prisma.place.update({
      where: { id: place.id },
      data: { images },
    });
    updated += 1;
    console.log(`Restored ${place.nameHe}`);
  }

  console.log(`Done. Restored ${updated} places.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
