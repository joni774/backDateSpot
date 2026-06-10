// Place helpers: localization, open-hours check (Israel timezone).

import type { Place, PlaceCategory, PriceRange } from "@datespot/database";

type Language = "he" | "en" | "ar";

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

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

/** Whether the place is open now based on openingHours JSON (Asia/Jerusalem). */
export function isPlaceOpenNow(openingHours: unknown): boolean {
  if (!openingHours || typeof openingHours !== "object") return false;
  const hours = openingHours as Record<string, string>;
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" })
  );
  const dayKey = DAY_KEYS[now.getDay()];
  const todayHours = hours[dayKey];
  if (!todayHours || todayHours.toLowerCase() === "closed") return false;

  const match = todayHours.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return false;

  const [, sh, sm, eh, em] = match;
  const start = parseInt(sh!, 10) * 60 + parseInt(sm!, 10);
  const end = parseInt(eh!, 10) * 60 + parseInt(em!, 10);
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= start && current <= end;
}

export type { PlaceCategory, PriceRange, Language };
