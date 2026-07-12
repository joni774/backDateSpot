import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  prisma,
  PlaceCategory,
  SubscriptionTier,
  PriceRange,
} from "@datespot/database";
import { placeCategorySchema } from "@datespot/places-logic";
import { noopAdminCacheHooks, type AdminCacheHooks } from "../cache";

const optionalUrl = z
  .string()
  .optional()
  .transform((v) => {
    if (!v || !v.trim()) return null;
    return v.trim();
  })
  .refine((v) => v == null || /^https?:\/\//i.test(v), { message: "Invalid URL" });

const placeBodySchema = z.object({
  nameHe: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  descriptionHe: z.string().min(1),
  descriptionEn: z.string().min(1),
  descriptionAr: z.string().min(1),
  category: placeCategorySchema,
  latitude: z.number(),
  longitude: z.number(),
  address: z.string().min(1),
  priceRange: z.nativeEnum(PriceRange),
  images: z.array(z.string()).default([]),
  openingHours: z.record(z.string()),
  phone: z.string().optional(),
  website: z.string().optional(),
  deliveryWoltUrl: optionalUrl,
  deliveryTenBisUrl: optionalUrl,
  deliveryMishlohaUrl: optionalUrl,
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
});

const placeUpdateSchema = placeBodySchema.partial();

export interface AdminRouterConfig {
  verifyTokenMiddleware: RequestHandler;
  requireAdmin: RequestHandler;
  cache?: AdminCacheHooks;
}

export function createAdminRouter(config: AdminRouterConfig): Router {
  const router = Router();
  const cache = config.cache ?? noopAdminCacheHooks;

  router.use(config.verifyTokenMiddleware);
  router.use(config.requireAdmin);

  router.get("/stats", async (_req, res) => {
    try {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const [totalUsers, weeklyActiveUsers, premiumUsers, vipUsers, totalPlaces] =
        await Promise.all([
          prisma.user.count(),
          prisma.user.count({ where: { lastLoginAt: { gte: weekAgo } } }),
          prisma.user.count({
            where: { subscriptionTier: SubscriptionTier.PREMIUM },
          }),
          prisma.user.count({ where: { subscriptionTier: SubscriptionTier.VIP } }),
          prisma.place.count({ where: { isActive: true } }),
        ]);

      const categoryCounts = await Promise.all(
        (Object.values(PlaceCategory) as PlaceCategory[]).map((category) =>
          prisma.place.count({ where: { category, isActive: true } })
        )
      );

      const placesByCategory = Object.fromEntries(
        (Object.values(PlaceCategory) as PlaceCategory[]).map((category, index) => [
          category,
          categoryCounts[index],
        ])
      ) as Record<PlaceCategory, number>;

      res.json({
        totalUsers,
        weeklyActiveUsers,
        premiumUsers,
        vipUsers,
        totalPlaces,
        placesByCategory,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  router.get("/places", async (req, res) => {
    try {
      const category = req.query.category as PlaceCategory | undefined;
      const isActive =
        req.query.isActive === "true"
          ? true
          : req.query.isActive === "false"
            ? false
            : undefined;

      const places = await prisma.place.findMany({
        where: {
          ...(category && { category }),
          ...(isActive !== undefined && { isActive }),
        },
        orderBy: { displayOrder: "asc" },
      });

      res.json({ places });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch places" });
    }
  });

  router.post("/places", async (req, res) => {
    try {
      const body = placeBodySchema.parse(req.body);
      const place = await prisma.place.create({ data: body });
      await cache.onPlacesMutated?.();
      res.status(201).json(place);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to create place" });
    }
  });

  router.put("/places/:id", async (req, res) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const body = placeUpdateSchema.parse(req.body);

      const existing = await prisma.place.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: "Place not found" });
        return;
      }

      const place = await prisma.place.update({ where: { id }, data: body });
      await cache.onPlacesMutated?.();
      res.json(place);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to update place" });
    }
  });

  router.delete("/places/:id", async (req, res) => {
    try {
      const id = z.string().uuid().parse(req.params.id);

      const existing = await prisma.place.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: "Place not found" });
        return;
      }

      const place = await prisma.place.update({
        where: { id },
        data: { isActive: false },
      });
      await cache.onPlacesMutated?.();
      res.json(place);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete place" });
    }
  });

  router.put("/places/:id/order", async (req, res) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const { displayOrder } = z
        .object({ displayOrder: z.number().int() })
        .parse(req.body);

      const existing = await prisma.place.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: "Place not found" });
        return;
      }

      const place = await prisma.place.update({
        where: { id },
        data: { displayOrder },
      });
      await cache.onPlacesMutated?.();
      res.json(place);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to update order" });
    }
  });

  router.get("/users", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit ?? "20"), 10))
      );
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            subscriptionTier: true,
            isAdmin: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.user.count(),
      ]);

      res.json({
        users,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  router.put("/users/:id/subscription", async (req, res) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const { tier } = z
        .object({ tier: z.nativeEnum(SubscriptionTier) })
        .parse(req.body);

      const existing = await prisma.user.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const user = await prisma.user.update({
        where: { id },
        data: { subscriptionTier: tier },
        select: {
          id: true,
          fullName: true,
          email: true,
          subscriptionTier: true,
        },
      });
      res.json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to update subscription" });
    }
  });

  return router;
}
