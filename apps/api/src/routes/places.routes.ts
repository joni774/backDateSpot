// Places API: list, detail, save/unsave, saved list.

import { Router } from "express";
import { z } from "zod";
import {
  prisma,
  PlaceCategory,
  SubscriptionTier,
  type Place,
} from "@datespot/database";
import { getDistanceKm } from "@datespot/utils";
import {
  optionalAuth,
  verifyTokenMiddleware,
} from "../middleware/auth.middleware";
import { isPlaceOpenNow, localizePlace } from "../utils/place.util";
import { placeCategorySchema } from "../schemas/place.schema";

const router = Router();

const listQuerySchema = z.object({
  category: placeCategorySchema.optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radius: z.coerce.number().default(10),
  language: z.enum(["he", "en", "ar"]).default("he"),
});

const saveSchema = z.object({
  placeId: z.string().uuid(),
});

function mapPlaceListItem(
  place: Place,
  language: "he" | "en" | "ar",
  distance: number | null,
  isLocked = false
) {
  const { name, description } = localizePlace(place, language);
  return {
    id: place.id,
    name,
    description,
    category: place.category,
    distance,
    priceRange: place.priceRange,
    images: place.images,
    openingHours: place.openingHours as Record<string, string>,
    isLocked,
  };
}

/**
 * GET / — nearby places sorted by distance.
 * FREE tier (or anonymous): max 5 unlocked + rest marked locked.
 */
router.get("/", optionalAuth, async (req, res) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const tier = req.user?.subscriptionTier ?? SubscriptionTier.FREE;
    const isPremium =
      tier === SubscriptionTier.PREMIUM || tier === SubscriptionTier.VIP;

    const where: { isActive: boolean; category?: PlaceCategory } = {
      isActive: true,
    };
    if (query.category) where.category = query.category;

    const places = await prisma.place.findMany({ where });

    const withDistance = places.map((place) => {
      let distance: number | null = null;
      if (query.lat != null && query.lng != null) {
        distance = Math.round(
          getDistanceKm(query.lat, query.lng, place.latitude, place.longitude) *
            10
        ) / 10;
      }
      return { place, distance };
    });

    let filtered = withDistance;
    if (query.lat != null && query.lng != null) {
      filtered = withDistance.filter(
        (p) =>
          p.distance === null ||
          p.distance <= query.radius
      );
      filtered.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    } else {
      filtered.sort((a, b) => a.place.displayOrder - b.place.displayOrder);
    }

    const results = filtered.map(({ place, distance }, index) => {
      const isLocked = !isPremium && index >= 5;
      return mapPlaceListItem(place, query.language, distance, isLocked);
    });

    res.json({ places: results });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.flatten() });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to fetch places" });
  }
});

/** GET /saved — authenticated user's saved places. */
router.get("/saved", verifyTokenMiddleware, async (req, res) => {
  try {
    const language =
      (req.query.language as "he" | "en" | "ar" | undefined) ?? "he";
    const saved = await prisma.savedPlace.findMany({
      where: { userId: req.user!.userId },
      include: { place: true },
      orderBy: { savedAt: "desc" },
    });
    const places = saved
      .filter((s) => s.place.isActive)
      .map((s) => mapPlaceListItem(s.place, language, null));
    res.json({ places });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch saved places" });
  }
});

/** POST /save — bookmark a place. */
router.post("/save", verifyTokenMiddleware, async (req, res) => {
  try {
    const body = saveSchema.parse(req.body);
    const place = await prisma.place.findUnique({
      where: { id: body.placeId },
    });
    if (!place || !place.isActive) {
      res.status(404).json({ error: "Place not found" });
      return;
    }
    const existing = await prisma.savedPlace.findUnique({
      where: {
        userId_placeId: {
          userId: req.user!.userId,
          placeId: body.placeId,
        },
      },
    });
    if (existing) {
      res.status(409).json({ error: "Place already saved" });
      return;
    }
    await prisma.savedPlace.create({
      data: { userId: req.user!.userId, placeId: body.placeId },
    });
    res.status(201).json({ message: "Place saved" });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.flatten() });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to save place" });
  }
});

/** DELETE /save/:placeId — remove bookmark. */
router.delete(
  "/save/:placeId",
  verifyTokenMiddleware,
  async (req, res) => {
    try {
      const placeId = z.string().uuid().parse(req.params.placeId);
      const deleted = await prisma.savedPlace.deleteMany({
        where: { userId: req.user!.userId, placeId },
      });
      if (deleted.count === 0) {
        res.status(404).json({ error: "Saved place not found" });
        return;
      }
      res.json({ message: "Place removed from saved" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid place id" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to unsave place" });
    }
  }
);

/** GET /:id — full place details with isOpen flag (Asia/Jerusalem). */
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const language =
      (req.query.language as "he" | "en" | "ar" | undefined) ?? "he";
    const place = await prisma.place.findUnique({ where: { id } });
    if (!place || !place.isActive) {
      res.status(404).json({ error: "Place not found" });
      return;
    }
    const { name, description } = localizePlace(place, language);
    let isSaved = false;
    if (req.user) {
      const saved = await prisma.savedPlace.findUnique({
        where: {
          userId_placeId: { userId: req.user.userId, placeId: id },
        },
      });
      isSaved = !!saved;
    }
    res.json({
      id: place.id,
      name,
      description,
      nameHe: place.nameHe,
      nameEn: place.nameEn,
      nameAr: place.nameAr,
      category: place.category,
      latitude: place.latitude,
      longitude: place.longitude,
      address: place.address,
      priceRange: place.priceRange,
      images: place.images,
      openingHours: place.openingHours,
      phone: place.phone,
      website: place.website,
      isOpen: isPlaceOpenNow(place.openingHours),
      isSaved,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid place id" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to fetch place" });
  }
});

export default router;
