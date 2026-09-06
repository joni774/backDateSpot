/**
 * Backfill kosher status from place names (Google/OSM names often include כשר / Badatz).
 *
 * Usage:
 *   pnpm db:enrich-kosher
 */
import { PrismaClient } from "@prisma/client";
import { detectKosherFromText, isFoodPlace } from "../../places-logic/src/kosher.util";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const prisma = new PrismaClient();

async function main() {
  const places = await prisma.place.findMany({
    where: { kosherStatus: "UNKNOWN" },
    select: {
      id: true,
      nameHe: true,
      nameEn: true,
      nameAr: true,
      category: true,
    },
  });

  let updated = 0;
  for (const place of places) {
    if (!isFoodPlace(place.category)) continue;
    const detected = detectKosherFromText(place.nameHe, place.nameEn, place.nameAr);
    if (detected.status === "UNKNOWN") continue;
    await prisma.place.update({
      where: { id: place.id },
      data: {
        kosherStatus: detected.status,
        kosherCertification: detected.certification,
      },
    });
    updated += 1;
  }

  console.log(`Enriched kosher status for ${updated} / ${places.length} places (food only).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
