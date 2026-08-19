import { z } from "zod";
import type { PlaceCategory, PriceRange } from "@datespot/database";
import {
  buildRecommendations,
  findRecommendedPlaces,
  type AiContext,
  type AiLanguage,
  type AiRecommendations,
} from "../recommender";

export const searchPlacesArgsSchema = z.object({
  category: z
    .enum([
      "RESTAURANT",
      "ROMANTIC_DATE",
      "SUSHI",
      "SUNSET",
      "ATTRACTION",
      "DAIRY_RESTAURANT",
      "MEAT_RESTAURANT",
    ])
    .optional(),
  budget: z.enum(["FREE", "BUDGET", "MODERATE", "EXPENSIVE"]).optional(),
  radiusKm: z.number().min(1).max(50).optional(),
  occasion: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  partySize: z.number().int().min(1).max(20).optional(),
});

export type SearchPlacesArgs = z.infer<typeof searchPlacesArgsSchema>;

export const SEARCH_PLACES_TOOL = {
  type: "function" as const,
  function: {
    name: "search_places",
    description:
      "Search DateSpot's internal places database for date/outing recommendations. Only call this for place recommendations.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "RESTAURANT",
            "ROMANTIC_DATE",
            "SUSHI",
            "SUNSET",
            "ATTRACTION",
            "DAIRY_RESTAURANT",
            "MEAT_RESTAURANT",
          ],
        },
        budget: {
          type: "string",
          enum: ["FREE", "BUDGET", "MODERATE", "EXPENSIVE"],
        },
        radiusKm: { type: "number", description: "Search radius in km (1-50)" },
        occasion: {
          type: "string",
          description: "e.g. first date, birthday, friends night",
        },
        lat: { type: "number" },
        lng: { type: "number" },
        partySize: { type: "number" },
      },
    },
  },
};

export type FindPlacesFn = (where: {
  isActive: boolean;
  category?: PlaceCategory;
  priceRange?: PriceRange;
}) => Promise<import("@datespot/database").Place[]>;

/**
 * Least-privilege place lookup for the LLM tool (policy §4.1).
 * Maps tool args → existing ranking pipeline; never exposes raw DB.
 */
export async function executeSearchPlaces(
  findMany: FindPlacesFn,
  args: SearchPlacesArgs,
  language: AiLanguage,
  defaults?: { lat?: number; lng?: number }
): Promise<{ recommendations: AiRecommendations | null; summary: string }> {
  const parsed = searchPlacesArgsSchema.parse(args);
  const ctx: AiContext = {
    step: "done",
    category: parsed.category as PlaceCategory | undefined,
    budget: parsed.budget as PriceRange | undefined,
    radiusKm: parsed.radiusKm ?? 10,
    partySize: parsed.partySize ?? 2,
    lat: parsed.lat ?? defaults?.lat,
    lng: parsed.lng ?? defaults?.lng,
    mood: parsed.occasion,
  };

  const ranked = await findRecommendedPlaces(findMany, ctx, language);
  const recommendations = buildRecommendations(ranked);

  if (!recommendations) {
    return {
      recommendations: null,
      summary: JSON.stringify({ found: 0, places: [] }),
    };
  }

  const places = [recommendations.primary, ...recommendations.alternatives].map(
    (p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      priceRange: p.priceRange,
      distanceKm: p.distanceKm,
      isOpen: p.isOpen,
    })
  );

  return {
    recommendations,
    summary: JSON.stringify({ found: places.length, places }),
  };
}
