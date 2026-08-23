/**
 * Backfill opening hours from Google Place Details for places with empty/unknown hours.
 *
 * Requires GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY.
 *
 * Usage:
 *   pnpm db:enrich-hours
 *   pnpm db:enrich-hours -- --limit 200
 */
import { PrismaClient } from "@prisma/client";
import {
  fetchGoogleOpeningHoursForBusiness,
  getGooglePlacesApiKey,
  googlePlacesSleep,
} from "../../places-logic/src/google-places";
import { hasUsableOpeningHours } from "../../places-logic/src/utils/opening-hours";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const prisma = new PrismaClient();

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf("--limit");
  if (idx >= 0 && argv[idx + 1]) {
    const n = parseInt(argv[idx + 1]!, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 500;
}

async function main() {
  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) {
    console.error(
      "GOOGLE_PLACES_API_KEY is missing. Add a Google Places API key (Place Details enabled) and retry."
    );
    process.exit(1);
  }

  const limit = parseLimit(process.argv.slice(2));
  const places = await prisma.place.findMany({
    where: { isActive: true },
    orderBy: [{ viewCount: "desc" }, { displayOrder: "asc" }],
    take: limit * 3,
  });

  const toUpdate = places
    .filter((place) => !hasUsableOpeningHours(place.openingHours))
    .slice(0, limit);

  console.log(
    `Found ${places.length} scanned places, ${toUpdate.length} need Google opening hours (limit ${limit})`
  );

  let updated = 0;
  let skipped = 0;

  for (const place of toUpdate) {
    try {
      const enriched = await fetchGoogleOpeningHoursForBusiness({
        apiKey,
        googlePlaceId: place.googlePlaceId,
        name: place.nameHe,
        altName: place.nameEn,
        lat: place.latitude,
        lng: place.longitude,
      });

      if (!enriched.hours) {
        skipped += 1;
        console.log(`No Google hours for ${place.nameHe}`);
        await googlePlacesSleep(200);
        continue;
      }

      await prisma.place.update({
        where: { id: place.id },
        data: { openingHours: enriched.hours },
      });
      updated += 1;
      console.log(
        `Updated ${place.nameHe} → ${enriched.hours.sunday} / ${enriched.hours.friday}`
      );
      await googlePlacesSleep(200);
    } catch (err) {
      console.warn(`Failed for ${place.nameHe}:`, err);
      skipped += 1;
      await googlePlacesSleep(200);
    }
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
