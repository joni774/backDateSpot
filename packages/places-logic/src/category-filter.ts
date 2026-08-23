import { PlaceCategory } from "@datespot/database";

/** "מסעדות" should include dairy / meat / sushi, not only the generic RESTAURANT tag. */
export const RESTAURANT_CATEGORIES: PlaceCategory[] = [
  PlaceCategory.RESTAURANT,
  PlaceCategory.DAIRY_RESTAURANT,
  PlaceCategory.MEAT_RESTAURANT,
  PlaceCategory.SUSHI,
];

const MEAT_RE =
  /בשר|סטייק|steak|grill|גריל|שווארמה|shawarma|המבורגר|hamburger|burger|בורגר|אסאדו|asado|bbq|ברביקיו|קבב|kebab|שניצל|schnitzel|מקדונלד|mcdonald|wolfnights|בורגוס|אסאדו/i;

const SUSHI_RE =
  /סושי|sushi|sashimi|סשימי|סאשימי|יפני|japanese|tokyo|oshi|ניגירי|nigiri|ramen|ראמן/i;

const DAIRY_RE =
  /חלבי|חלב|dairy|cafe|café|קפה|coffee|מאפה|bakery|מאפייה|פיצה|pizza|גלידה|ice\s*cream|פנקייק|pancake|וופל|waffle|פלאפל|falafel|שווארמה לא|בית קפה/i;

const ROMANTIC_RE =
  /בר|bar|pub|פאב|מועדון|club|nightlife|יין|wine|קוקטייל|cocktail|בילוי|דייט|date\s*night/i;

export function prismaCategoryFilter(
  category?: string
): PlaceCategory | { in: PlaceCategory[] } | undefined {
  if (!category) return undefined;
  if (
    category === "RESTAURANT" ||
    category === "MEAT_RESTAURANT" ||
    category === "SUSHI" ||
    category === "DAIRY_RESTAURANT"
  ) {
    return { in: RESTAURANT_CATEGORIES };
  }
  if (category === "ATTRACTION") {
    return { in: [PlaceCategory.ATTRACTION, PlaceCategory.SUNSET] };
  }
  if (category === "ROMANTIC_DATE") {
    return {
      in: [PlaceCategory.ROMANTIC_DATE, PlaceCategory.RESTAURANT, PlaceCategory.DAIRY_RESTAURANT],
    };
  }
  return category as PlaceCategory;
}

export function classifyFoodName(name: string): PlaceCategory | undefined {
  if (SUSHI_RE.test(name)) return PlaceCategory.SUSHI;
  if (MEAT_RE.test(name)) return PlaceCategory.MEAT_RESTAURANT;
  if (DAIRY_RE.test(name)) return PlaceCategory.DAIRY_RESTAURANT;
  return undefined;
}

export function placeMatchesCategory(
  place: {
    category: PlaceCategory;
    nameHe: string;
    nameEn: string;
    nameAr: string;
  },
  category?: string
): boolean {
  if (!category) return true;
  const names = `${place.nameHe} ${place.nameEn} ${place.nameAr}`;
  if (category === "RESTAURANT") {
    return RESTAURANT_CATEGORIES.includes(place.category);
  }
  if (category === "MEAT_RESTAURANT") {
    return (
      place.category === PlaceCategory.MEAT_RESTAURANT || MEAT_RE.test(names)
    );
  }
  if (category === "SUSHI") {
    return place.category === PlaceCategory.SUSHI || SUSHI_RE.test(names);
  }
  if (category === "DAIRY_RESTAURANT") {
    return (
      place.category === PlaceCategory.DAIRY_RESTAURANT || DAIRY_RE.test(names)
    );
  }
  if (category === "ROMANTIC_DATE") {
    return (
      place.category === PlaceCategory.ROMANTIC_DATE || ROMANTIC_RE.test(names)
    );
  }
  if (category === "ATTRACTION") {
    return (
      place.category === PlaceCategory.ATTRACTION ||
      place.category === PlaceCategory.SUNSET
    );
  }
  return place.category === category;
}
