import type { Place, PlaceCategory, PriceRange } from "@datespot/database";

export {
  DAY_KEYS,
  emptyOpeningHours,
  hasUsableOpeningHours,
  isPlaceOpenNow,
  normalizeGoogleOpeningHours,
  type DayKey,
  type GoogleOpeningHours,
  type OpeningHoursMap,
} from "./opening-hours";

type Language = "he" | "en" | "ar";

export function localizePlace(
  place: Place,
  language: Language
): { name: string; description: string } {
  switch (language) {
    case "en":
      return { name: place.nameEn, description: place.descriptionEn };
    case "ar":
      return { name: place.nameAr, description: place.descriptionAr };
    default:
      return { name: place.nameHe, description: place.descriptionHe };
  }
}

export type { PlaceCategory, PriceRange, Language };
