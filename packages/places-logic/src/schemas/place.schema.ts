import { z } from "zod";

export const PLACE_CATEGORY_VALUES = [
  "ROMANTIC_DATE",
  "RESTAURANT",
  "DAIRY_RESTAURANT",
  "MEAT_RESTAURANT",
  "SUSHI",
  "SUNSET",
  "ATTRACTION",
] as const;

export const placeCategorySchema = z.enum(PLACE_CATEGORY_VALUES);
