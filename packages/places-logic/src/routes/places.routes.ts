import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import {
  prisma,
  PlaceCategory,
  SubscriptionTier,
  type Place,
} from "@datespot/database";
import { getDistanceKm } from "@datespot/utils";
import {
  PLACES_LIST_KEY,
  PLACES_LIST_TTL,
  noopPlacesListCache,
  type PlacesListCache,
} from "../cache";
import {
  buildGooglePhotoFetchUrl,
  resolvePlaceImageUrls,
} from "../google-places";
import { placeCategorySchema } from "../schemas/place.schema";
import { isPlaceOpenNow, localizePlace } from "../utils/place.util";

const listQuerySchema = z.object({
  category: placeCategorySchema.optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radius: z.coerce.number().default(10),
  language: z.enum(["he", "en", "ar"]).default("he"),
  q: z.string().min(1).optional(),
});

const saveSchema = z.object({
  placeId: z.string().uuid(),
});

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().max(1000).optional(),
});

/** Bounding-box padding in degrees (~1 deg ≈ 111 km). */
function radiusToBoundingBox(lat: number, lng: number, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

function getRequestBaseUrl(req: Request, publicApiUrl?: string): string {
  if (publicApiUrl) return publicApiUrl.replace(/\/$/, "");
  const forwarded = req.get("x-forwarded-proto");
  const proto = forwarded ? forwarded.split(",")[0].trim() : req.protocol;
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

function mapPlaceListItem(
  place: Place,
  language: "he" | "en" | "ar",
  distance: number | null,
  isLocked = false,
  baseUrl?: string
) {
  const { name, description } = localizePlace(place, language);
  return {
    id: place.id,
    name,
    description,
    category: place.category,
    distance,
    priceRange: place.priceRange,
    images: baseUrl ? resolvePlaceImageUrls(place.images, baseUrl) : place.images,
    openingHours: place.openingHours as Record<string, string>,
    isLocked,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

export interface PlacesRouterConfig {
  optionalAuth: RequestHandler;
  verifyTokenMiddleware: RequestHandler;
  cache?: PlacesListCache;
  googlePlacesApiKey?: string;
  publicApiUrl?: string;
}

export function createPlacesRouter(config: PlacesRouterConfig): Router {
  const router = Router();
  const cache = config.cache ?? noopPlacesListCache;

  /**
   * GET / — nearby places sorted by distance.
   * Bounding-box pre-filter in Prisma, then exact Haversine sort.
   * FREE tier: first 5 unlocked, rest marked locked.
   */
  router.get("/", config.optionalAuth, async (req, res) => {
    try {
      const query = listQuerySchema.parse(req.query);
      const baseUrl = getRequestBaseUrl(req, config.publicApiUrl);
      const tier = req.user?.subscriptionTier ?? SubscriptionTier.FREE;
      const isVip = tier === SubscriptionTier.VIP;

      const cacheKey = `${PLACES_LIST_KEY}:${query.category ?? "all"}:${query.lat ?? ""}:${query.lng ?? ""}:${query.radius}`;

      let rawPlaces: Place[] | null = null;

      const cached = await cache.get(cacheKey);
      if (cached) rawPlaces = JSON.parse(cached) as Place[];

      if (!rawPlaces) {
        const where: {
          isActive: boolean;
          category?: PlaceCategory;
          latitude?: { gte: number; lte: number };
          longitude?: { gte: number; lte: number };
        } = { isActive: true };
        if (query.category) where.category = query.category as PlaceCategory;

        if (query.lat != null && query.lng != null) {
          const bb = radiusToBoundingBox(query.lat, query.lng, query.radius);
          where.latitude = { gte: bb.minLat, lte: bb.maxLat };
          where.longitude = { gte: bb.minLng, lte: bb.maxLng };
        }

        rawPlaces = await prisma.place.findMany({ where });
        await cache.set(cacheKey, JSON.stringify(rawPlaces), PLACES_LIST_TTL);
      }

      const withDistance = rawPlaces.map((place) => {
        let distance: number | null = null;
        if (query.lat != null && query.lng != null) {
          distance =
            Math.round(
              getDistanceKm(query.lat, query.lng, place.latitude, place.longitude) * 10
            ) / 10;
        }
        return { place, distance };
      });

      let filtered = withDistance;
      if (query.q) {
        const q = query.q.toLowerCase();
        filtered = filtered.filter(({ place }) => {
          const haystack = [
            place.nameHe,
            place.nameEn,
            place.nameAr,
            place.descriptionHe,
            place.descriptionEn,
            place.descriptionAr,
            place.address,
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        });
      }
      if (query.lat != null && query.lng != null) {
        filtered = withDistance.filter(
          (p) => p.distance === null || p.distance <= query.radius
        );
        filtered.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
      } else {
        filtered.sort((a, b) => a.place.displayOrder - b.place.displayOrder);
      }

      const results = filtered.map(({ place, distance }, index) => {
        const isLocked = !isVip && index >= 5;
        return mapPlaceListItem(place, query.language, distance, isLocked, baseUrl);
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

  router.get("/saved", config.verifyTokenMiddleware, async (req, res) => {
    try {
      const baseUrl = getRequestBaseUrl(req, config.publicApiUrl);
      const language =
        (req.query.language as "he" | "en" | "ar" | undefined) ?? "he";
      const saved = await prisma.savedPlace.findMany({
        where: { userId: req.user!.userId },
        include: { place: true },
        orderBy: { savedAt: "desc" },
      });
      const places = saved
        .filter((s) => s.place.isActive)
        .map((s) => mapPlaceListItem(s.place, language, null, false, baseUrl));
      res.json({ places });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch saved places" });
    }
  });

  router.post("/save", config.verifyTokenMiddleware, async (req, res) => {
    try {
      const body = saveSchema.parse(req.body);
      const place = await prisma.place.findUnique({ where: { id: body.placeId } });
      if (!place || !place.isActive) {
        res.status(404).json({ error: "Place not found" });
        return;
      }
      const existing = await prisma.savedPlace.findUnique({
        where: {
          userId_placeId: { userId: req.user!.userId, placeId: body.placeId },
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

  router.delete("/save/:placeId", config.verifyTokenMiddleware, async (req, res) => {
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
  });

  router.get("/favorites", config.verifyTokenMiddleware, async (req, res) => {
    try {
      const baseUrl = getRequestBaseUrl(req, config.publicApiUrl);
      const language =
        (req.query.language as "he" | "en" | "ar" | undefined) ?? "he";
      const favorites = await prisma.favorite.findMany({
        where: { userId: req.user!.userId },
        include: { place: true },
        orderBy: { createdAt: "desc" },
      });
      const places = favorites
        .filter((f) => f.place.isActive)
        .map((f) => mapPlaceListItem(f.place, language, null, false, baseUrl));
      res.json({ places });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch favorites" });
    }
  });

  router.post("/favorites", config.verifyTokenMiddleware, async (req, res) => {
    try {
      const body = saveSchema.parse(req.body);
      const place = await prisma.place.findUnique({ where: { id: body.placeId } });
      if (!place || !place.isActive) {
        res.status(404).json({ error: "Place not found" });
        return;
      }
      const existing = await prisma.favorite.findUnique({
        where: {
          userId_placeId: { userId: req.user!.userId, placeId: body.placeId },
        },
      });
      if (existing) {
        res.status(409).json({ error: "Place already in favorites" });
        return;
      }
      await prisma.favorite.create({
        data: { userId: req.user!.userId, placeId: body.placeId },
      });
      res.status(201).json({ message: "Added to favorites" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to add favorite" });
    }
  });

  router.delete("/favorites/:placeId", config.verifyTokenMiddleware, async (req, res) => {
    try {
      const placeId = z.string().uuid().parse(req.params.placeId);
      const deleted = await prisma.favorite.deleteMany({
        where: { userId: req.user!.userId, placeId },
      });
      if (deleted.count === 0) {
        res.status(404).json({ error: "Favorite not found" });
        return;
      }
      res.json({ message: "Removed from favorites" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid place id" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to remove favorite" });
    }
  });

  router.get("/photo", async (req, res) => {
    try {
      const ref = z.string().min(1).parse(req.query.ref);
      const apiKey = config.googlePlacesApiKey;
      if (!apiKey) {
        res.status(503).json({ error: "Google Places photo service unavailable" });
        return;
      }

      const photoUrl = buildGooglePhotoFetchUrl(ref, apiKey);
      const photoRes = await fetch(photoUrl, { redirect: "follow" });
      if (!photoRes.ok) {
        res.status(502).json({ error: "Failed to fetch place photo" });
        return;
      }

      res.set(
        "Content-Type",
        photoRes.headers.get("content-type") ?? "image/jpeg"
      );
      res.set("Cache-Control", "public, max-age=86400");
      const buffer = Buffer.from(await photoRes.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid photo reference" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to fetch place photo" });
    }
  });

  router.get("/:id/reviews", async (req, res) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const reviews = await prisma.review.findMany({
        where: { placeId: id },
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const avg = await prisma.review.aggregate({
        where: { placeId: id },
        _avg: { rating: true },
        _count: { rating: true },
      });
      res.json({
        reviews: reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          text: r.text,
          userName: r.user.fullName,
          createdAt: r.createdAt.toISOString(),
        })),
        averageRating: avg._avg.rating ?? null,
        reviewCount: avg._count.rating,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid place id" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to fetch reviews" });
    }
  });

  router.post("/:id/reviews", config.verifyTokenMiddleware, async (req, res) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const body = reviewSchema.parse(req.body);
      const place = await prisma.place.findUnique({ where: { id } });
      if (!place || !place.isActive) {
        res.status(404).json({ error: "Place not found" });
        return;
      }
      const review = await prisma.review.upsert({
        where: {
          userId_placeId: { userId: req.user!.userId, placeId: id },
        },
        create: {
          userId: req.user!.userId,
          placeId: id,
          rating: body.rating,
          text: body.text,
        },
        update: { rating: body.rating, text: body.text },
      });
      res.status(201).json({ review });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to submit review" });
    }
  });

  /**
   * GET /:id — full place details.
   * Freemium gate: FREE users cannot access places beyond index 5; VIP unlocks all.
   */
  router.get("/:id", config.optionalAuth, async (req, res) => {
    try {
      const baseUrl = getRequestBaseUrl(req, config.publicApiUrl);
      const id = z.string().uuid().parse(req.params.id);
      const language =
        (req.query.language as "he" | "en" | "ar" | undefined) ?? "he";
      const place = await prisma.place.findUnique({ where: { id } });
      if (!place || !place.isActive) {
        res.status(404).json({ error: "Place not found" });
        return;
      }

      const tier = req.user?.subscriptionTier ?? SubscriptionTier.FREE;
      if (tier !== SubscriptionTier.VIP) {
        const rank = await prisma.place.count({
          where: { isActive: true, displayOrder: { lt: place.displayOrder } },
        });
        if (rank >= 5) {
          res.status(403).json({ error: "VIP required" });
          return;
        }
      }

      await prisma.place.update({
        where: { id },
        data: { viewCount: { increment: 1 } },
      });

      const { name, description } = localizePlace(place, language);
      let isSaved = false;
      let isFavorite = false;
      if (req.user) {
        const [saved, favorite] = await Promise.all([
          prisma.savedPlace.findUnique({
            where: { userId_placeId: { userId: req.user.userId, placeId: id } },
          }),
          prisma.favorite.findUnique({
            where: { userId_placeId: { userId: req.user.userId, placeId: id } },
          }),
        ]);
        isSaved = !!saved;
        isFavorite = !!favorite;
      }

      const ratingAgg = await prisma.review.aggregate({
        where: { placeId: id },
        _avg: { rating: true },
        _count: { rating: true },
      });

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
        images: resolvePlaceImageUrls(place.images, baseUrl),
        openingHours: place.openingHours,
        phone: place.phone,
        website: place.website,
        deliveryWoltUrl: place.deliveryWoltUrl,
        deliveryTenBisUrl: place.deliveryTenBisUrl,
        deliveryMishlohaUrl: place.deliveryMishlohaUrl,
        isOpen: isPlaceOpenNow(place.openingHours),
        isSaved,
        isFavorite,
        viewCount: place.viewCount + 1,
        averageRating: ratingAgg._avg.rating ?? null,
        reviewCount: ratingAgg._count.rating,
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

  return router;
}
