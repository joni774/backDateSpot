import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  prisma,
  PlaceCategory,
  SubscriptionTier,
  PriceRange,
  LeadType,
} from "@datespot/database";
import { placeCategorySchema, fetchPlaceImages, needsGooglePhoto, stockImageForCategory, persistPlacePhotoCache, FOOD_CATEGORIES, findPlacesSafe } from "@datespot/places-logic";
import { noopAdminCacheHooks, type AdminCacheHooks } from "../cache";

const optionalUrl = z
  .string()
  .optional()
  .transform((v) => {
    if (!v || !v.trim()) return null;
    return v.trim();
  })
  .refine((v) => v == null || /^https?:\/\//i.test(v), { message: "Invalid URL" });

const optionalDateTime = z
  .union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return new Date(`${v}T23:59:59.000Z`);
    }
    return new Date(v);
  });

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
  deliveryCibusUrl: optionalUrl,
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
  leadFeeAgorot: z.number().int().min(0).optional(),
  sponsoredUntil: optionalDateTime,
  sponsoredPriority: z.number().int().optional(),
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

      const [totalUsers, weeklyActiveUsers, premiumUsers, vipUsers, totalPlaces, totalLeads, weeklyLeads, leadFeeSum] =
        await Promise.all([
          prisma.user.count(),
          prisma.user.count({ where: { lastLoginAt: { gte: weekAgo } } }),
          prisma.user.count({
            where: { subscriptionTier: SubscriptionTier.PREMIUM },
          }),
          prisma.user.count({ where: { subscriptionTier: SubscriptionTier.VIP } }),
          prisma.place.count({ where: { isActive: true } }),
          prisma.placeLead.count(),
          prisma.placeLead.count({ where: { createdAt: { gte: weekAgo } } }),
          prisma.placeLead.aggregate({ _sum: { feeAgorot: true } }),
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
        totalLeads,
        weeklyLeads,
        leadRevenueAgorot: leadFeeSum._sum.feeAgorot ?? 0,
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

      const places = await findPlacesSafe({
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

  router.post("/enrich-photos", async (req, res) => {
    try {
      const limit = Math.min(60, Math.max(1, parseInt(String(req.body?.limit ?? req.query.limit ?? "20"), 10)));
      const offset = Math.max(0, parseInt(String(req.body?.offset ?? req.query.offset ?? "0"), 10));

      const places = await findPlacesSafe({ orderBy: { id: "asc" } });
      const slice = places.slice(offset, offset + limit);
      const pending = slice.filter((place) => needsGooglePhoto(place.images));

      let updated = 0;
      let skipped = 0;
      const details: Array<{ name: string; result: "updated" | "skipped" }> = [];

      for (const place of pending) {
        try {
          const fetched = await fetchPlaceImages({
            nameHe: place.nameHe,
            nameEn: place.nameEn,
            category: place.category,
            latitude: place.latitude,
            longitude: place.longitude,
            address: place.address,
            googlePlaceId: place.googlePlaceId,
          });

          if (fetched.images.length === 0) {
            skipped += 1;
            details.push({ name: place.nameHe, result: "skipped" });
            continue;
          }

          await persistPlacePhotoCache({
            placeId: place.id,
            images: fetched.images,
            googlePlaceId: fetched.googlePlaceId,
          });
          updated += 1;
          details.push({ name: place.nameHe, result: "updated" });
        } catch (err) {
          console.warn(`[admin] enrich-photos failed for ${place.nameHe}:`, err);
          skipped += 1;
          details.push({ name: place.nameHe, result: "skipped" });
        }
      }

      await cache.onPlacesMutated?.();

      const stillNeeding = places.filter((place) => needsGooglePhoto(place.images)).length - updated;
      const nextOffset = offset + limit;

      res.json({
        totalPlaces: places.length,
        offset,
        nextOffset,
        done: nextOffset >= places.length,
        sliceSize: slice.length,
        candidatesInSlice: pending.length,
        updated,
        skipped,
        stillNeedingPhotos: Math.max(0, stillNeeding),
        details,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to enrich photos" });
    }
  });

  router.post("/restore-photos", async (_req, res) => {
    try {
      const places = await findPlacesSafe({ orderBy: { id: "asc" } });
      const toFix = places.filter(
        (place) => place.images.length === 0 || needsGooglePhoto(place.images)
      );

      let googleUpdated = 0;
      let stockFallback = 0;
      let skipped = 0;

      for (const place of toFix) {
        try {
          const fetched = await fetchPlaceImages({
            nameHe: place.nameHe,
            nameEn: place.nameEn,
            category: place.category,
            latitude: place.latitude,
            longitude: place.longitude,
            address: place.address,
            googlePlaceId: place.googlePlaceId,
          });

          if (fetched.images.length === 0) {
            if (place.images.length === 0 && !FOOD_CATEGORIES.has(place.category)) {
              await prisma.place.update({
                where: { id: place.id },
                data: { images: [stockImageForCategory(place.category)] },
              });
              stockFallback += 1;
            } else {
              skipped += 1;
            }
            continue;
          }

          await persistPlacePhotoCache({
            placeId: place.id,
            images: fetched.images,
            googlePlaceId: fetched.googlePlaceId,
          });
          googleUpdated += 1;
        } catch (err) {
          console.warn(`[admin] restore-photos failed for ${place.nameHe}:`, err);
          skipped += 1;
        }
      }

      await cache.onPlacesMutated?.();

      res.json({
        totalPlaces: places.length,
        needingFix: toFix.length,
        googleUpdated,
        stockFallback,
        skipped,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to restore photos" });
    }
  });

  router.get("/leads", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit ?? "30"), 10))
      );
      const skip = (page - 1) * limit;
      const placeId =
        typeof req.query.placeId === "string" && req.query.placeId
          ? z.string().uuid().parse(req.query.placeId)
          : undefined;
      const type =
        typeof req.query.type === "string" && req.query.type
          ? z.nativeEnum(LeadType).parse(req.query.type)
          : undefined;

      const where = {
        ...(placeId && { placeId }),
        ...(type && { type }),
      };

      const [leads, total] = await Promise.all([
        prisma.placeLead.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            place: { select: { id: true, nameHe: true, nameEn: true } },
            user: { select: { id: true, fullName: true, email: true } },
          },
        }),
        prisma.placeLead.count({ where }),
      ]);

      res.json({
        leads: leads.map((lead) => ({
          id: lead.id,
          type: lead.type,
          feeAgorot: lead.feeAgorot,
          createdAt: lead.createdAt.toISOString(),
          place: {
            id: lead.place.id,
            nameHe: lead.place.nameHe,
            nameEn: lead.place.nameEn,
          },
          user: {
            id: lead.user.id,
            fullName: lead.user.fullName,
            email: lead.user.email,
          },
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to fetch leads" });
    }
  });

  return router;
}
