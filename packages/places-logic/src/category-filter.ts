import { PlaceCategory } from "@datespot/database";

/** "מסעדות" should include dairy / meat / sushi, not only the generic RESTAURANT tag. */
export const RESTAURANT_CATEGORIES: PlaceCategory[] = [
  PlaceCategory.RESTAURANT,
  PlaceCategory.DAIRY_RESTAURANT,
  PlaceCategory.MEAT_RESTAURANT,
  PlaceCategory.SUSHI,
];

export function prismaCategoryFilter(
  category?: string
): PlaceCategory | { in: PlaceCategory[] } | undefined {
  if (!category) return undefined;
  if (category === "RESTAURANT") {
    return { in: RESTAURANT_CATEGORIES };
  }
  return category as PlaceCategory;
}
