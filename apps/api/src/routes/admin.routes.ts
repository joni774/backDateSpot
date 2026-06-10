// Admin API — stats, places CRUD, user management (admin only).

import { Router } from "express";
import { z } from "zod";
import {
  prisma,
  PlaceCategory,
  SubscriptionTier,
  PriceRange,
} from "@datespot/database";
import {
  verifyTokenMiddleware,
  requireAdmin,
} from "../middleware/auth.middleware";
import { placeCategorySchema } from "../schemas/place.schema";

const router = Router();

router.use(verifyTokenMiddleware);
router.use(requireAdmin);

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
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
});

const placeUpdateSchema = placeBodySchema.partial();

/**
 * GET /stats — dashboard metrics.
 */
router.get("/stats", async (_req, res) => {
  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [totalUsers, weeklyActiveUsers, premiumUsers, vipUsers, totalPlaces] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { updatedAt: { gte: weekAgo } } }),
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

/**
 * GET /places — all places for admin (optional filters).
 */
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

    res.json({
      places: places.map((p) => ({ ...p, viewCount: 0 })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch places" });
  }
});

/**
 * POST /places — create a new place.
 */
router.post("/places", async (req, res) => {
  try {
    const body = placeBodySchema.parse(req.body);
    const place = await prisma.place.create({ data: body });
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

/**
 * PUT /places/:id — update place fields.
 */
router.put("/places/:id", async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = placeUpdateSchema.parse(req.body);
    const place = await prisma.place.update({ where: { id }, data: body });
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

/**
 * DELETE /places/:id — soft delete (isActive = false).
 */
router.delete("/places/:id", async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const place = await prisma.place.update({
      where: { id },
      data: { isActive: false },
    });
    res.json(place);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete place" });
  }
});

/**
 * PUT /places/:id/order — update display order.
 */
router.put("/places/:id/order", async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { displayOrder } = z
      .object({ displayOrder: z.number().int() })
      .parse(req.body);
    const place = await prisma.place.update({
      where: { id },
      data: { displayOrder },
    });
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

/**
 * GET /users — paginated user list.
 */
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

/**
 * PUT /users/:id/subscription — change user tier.
 */
router.put("/users/:id/subscription", async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { tier } = z
      .object({ tier: z.nativeEnum(SubscriptionTier) })
      .parse(req.body);
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

export default router;
