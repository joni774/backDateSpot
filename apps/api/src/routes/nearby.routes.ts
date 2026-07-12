/** Nearby people — location-based discovery with privacy controls. */
import { prisma } from "@datespot/database";
import { getDistanceKm } from "@datespot/utils";
import { Router } from "express";
import { z } from "zod";

import { verifyTokenMiddleware } from "../middleware/auth.middleware";

const router = Router();

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const MAX_RADIUS_KM = 3;
const LIST_RATE_LIMIT = 12;
const listRateMap = new Map<string, { count: number; resetAt: number }>();

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Bucket distance for privacy — never expose exact coordinates. */
export function formatApproxDistanceKm(km: number): string {
  const meters = km * 1000;
  if (meters < 250) return "~200m";
  if (meters < 450) return "~500m";
  if (meters < 750) return "~700m";
  if (km < 1.5) return "~1km";
  if (km < 2.5) return "~2km";
  return `~${Math.round(km)}km`;
}

function checkListRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = listRateMap.get(userId);
  if (!entry || now > entry.resetAt) {
    listRateMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= LIST_RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

async function getBlockedUserIds(userId: string): Promise<Set<string>> {
  const blocks = await prisma.nearbyBlock.findMany({
    where: {
      OR: [{ blockerId: userId }, { blockedId: userId }],
    },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<string>();
  for (const b of blocks) {
    ids.add(b.blockerId === userId ? b.blockedId : b.blockerId);
  }
  return ids;
}

function serializeNearbyUser(
  user: { id: string; fullName: string; age: number },
  distanceKm: number,
  interestSent: boolean,
  interestReceived: boolean,
  matched: boolean
) {
  return {
    id: user.id,
    displayName: firstName(user.fullName),
    age: user.age,
    approxDistance: formatApproxDistanceKm(distanceKm),
    interestSent,
    interestReceived,
    matched,
  };
}

router.use(verifyTokenMiddleware);

/** GET /status — current user's nearby settings. */
router.get("/status", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        ageVerifiedAt: true,
        isVisibleNearby: true,
        nearbyUpdatedAt: true,
        subscriptionTier: true,
      },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const online =
      user.isVisibleNearby &&
      user.nearbyUpdatedAt != null &&
      Date.now() - user.nearbyUpdatedAt.getTime() < ONLINE_WINDOW_MS;

    res.json({
      ageVerified: user.ageVerifiedAt != null,
      ageVerifiedAt: user.ageVerifiedAt?.toISOString() ?? null,
      isVisibleNearby: user.isVisibleNearby,
      isOnline: online,
      datingSubscribed: user.subscriptionTier === "DATING",
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch nearby status" });
  }
});

const verifyAgeSchema = z.object({
  confirmed: z.literal(true),
});

/** POST /verify-age — explicit 18+ confirmation (separate from registration). */
router.post("/verify-age", async (req, res) => {
  try {
    const body = verifyAgeSchema.parse(req.body);
    if (!body.confirmed) {
      res.status(400).json({ error: "Age confirmation required" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, age: true },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.age < 18) {
      res.status(403).json({ error: "Must be 18 or older" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { ageVerifiedAt: new Date() },
      select: { ageVerifiedAt: true },
    });

    res.json({
      message: "Age verified",
      ageVerifiedAt: updated.ageVerifiedAt!.toISOString(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.status(500).json({ error: "Failed to verify age" });
  }
});

const presenceSchema = z.object({
  visible: z.boolean(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/** PUT /presence — toggle visibility and refresh location (server-side only). */
router.put("/presence", async (req, res) => {
  try {
    const body = presenceSchema.parse(req.body);
    const userId = req.user!.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { ageVerifiedAt: true, age: true, subscriptionTier: true },
    });
    if (!user?.ageVerifiedAt) {
      res.status(403).json({ error: "Age verification required" });
      return;
    }
    if (user.age < 18) {
      res.status(403).json({ error: "Must be 18 or older" });
      return;
    }
    if (user.subscriptionTier !== "DATING") {
      res.status(403).json({ error: "Dating subscription required" });
      return;
    }

    if (body.visible && (body.lat == null || body.lng == null)) {
      res.status(400).json({ error: "Location required when visible" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: body.visible
        ? {
            isVisibleNearby: true,
            nearbyLat: body.lat,
            nearbyLng: body.lng,
            nearbyUpdatedAt: new Date(),
          }
        : {
            isVisibleNearby: false,
            nearbyUpdatedAt: null,
          },
      select: { isVisibleNearby: true, nearbyUpdatedAt: true },
    });

    res.json({
      isVisibleNearby: updated.isVisibleNearby,
      isOnline: updated.isVisibleNearby,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.status(500).json({ error: "Failed to update presence" });
  }
});

const listQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/** GET /users — nearby visible users (approximate distance only). */
router.get("/users", async (req, res) => {
  try {
    const userId = req.user!.userId;
    if (!checkListRateLimit(userId)) {
      res.status(429).json({ error: "Too many requests. Try again shortly." });
      return;
    }

    const query = listQuerySchema.parse(req.query);
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { ageVerifiedAt: true, isVisibleNearby: true, age: true, subscriptionTier: true },
    });
    if (!me?.ageVerifiedAt) {
      res.status(403).json({ error: "Age verification required" });
      return;
    }
    if (me.subscriptionTier !== "DATING") {
      res.status(403).json({ error: "Dating subscription required" });
      return;
    }

    // Refresh caller presence timestamp when visible
    if (me.isVisibleNearby) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          nearbyLat: query.lat,
          nearbyLng: query.lng,
          nearbyUpdatedAt: new Date(),
        },
      });
    }

    const blocked = await getBlockedUserIds(userId);
    const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MS);

    const candidates = await prisma.user.findMany({
      where: {
        id: { not: userId },
        ageVerifiedAt: { not: null },
        isVisibleNearby: true,
        nearbyUpdatedAt: { gte: onlineSince },
        nearbyLat: { not: null },
        nearbyLng: { not: null },
        age: { gte: 18 },
      },
      select: {
        id: true,
        fullName: true,
        age: true,
        nearbyLat: true,
        nearbyLng: true,
      },
    });

    const [sentInterests, receivedInterests] = await Promise.all([
      prisma.nearbyInterest.findMany({
        where: { fromUserId: userId },
        select: { toUserId: true },
      }),
      prisma.nearbyInterest.findMany({
        where: { toUserId: userId },
        select: { fromUserId: true },
      }),
    ]);
    const sentSet = new Set(sentInterests.map((i) => i.toUserId));
    const receivedSet = new Set(receivedInterests.map((i) => i.fromUserId));

    const users = candidates
      .filter((u) => !blocked.has(u.id))
      .map((u) => {
        const distanceKm = getDistanceKm(
          query.lat,
          query.lng,
          u.nearbyLat!,
          u.nearbyLng!
        );
        const interestSent = sentSet.has(u.id);
        const interestReceived = receivedSet.has(u.id);
        return {
          user: serializeNearbyUser(
            u,
            distanceKm,
            interestSent,
            interestReceived,
            interestSent && interestReceived
          ),
          distanceKm,
        };
      })
      .filter((item) => item.distanceKm <= MAX_RADIUS_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .map((item) => item.user);

    res.json({ users });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.status(500).json({ error: "Failed to fetch nearby users" });
  }
});

/** POST /interest/:userId — express interest; returns match if mutual. */
router.post("/interest/:targetUserId", async (req, res) => {
  try {
    const userId = req.user!.userId;
    const targetUserId = req.params.targetUserId;

    if (targetUserId === userId) {
      res.status(400).json({ error: "Cannot interest yourself" });
      return;
    }

    const blocked = await getBlockedUserIds(userId);
    if (blocked.has(targetUserId)) {
      res.status(403).json({ error: "User unavailable" });
      return;
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, isVisibleNearby: true, ageVerifiedAt: true },
    });
    if (!target?.isVisibleNearby || !target.ageVerifiedAt) {
      res.status(404).json({ error: "User not available" });
      return;
    }

    await prisma.nearbyInterest.upsert({
      where: {
        fromUserId_toUserId: { fromUserId: userId, toUserId: targetUserId },
      },
      create: { fromUserId: userId, toUserId: targetUserId },
      update: {},
    });

    const mutual = await prisma.nearbyInterest.findUnique({
      where: {
        fromUserId_toUserId: { fromUserId: targetUserId, toUserId: userId },
      },
    });

    res.json({ matched: !!mutual });
  } catch {
    res.status(500).json({ error: "Failed to send interest" });
  }
});

/** GET /matches — mutual interests. */
router.get("/matches", async (req, res) => {
  try {
    const userId = req.user!.userId;
    const blocked = await getBlockedUserIds(userId);

    const sent = await prisma.nearbyInterest.findMany({
      where: { fromUserId: userId },
      select: { toUserId: true },
    });
    const sentIds = sent.map((s) => s.toUserId);

    if (sentIds.length === 0) {
      res.json({ matches: [] });
      return;
    }

    const mutual = await prisma.nearbyInterest.findMany({
      where: {
        fromUserId: { in: sentIds },
        toUserId: userId,
      },
      include: {
        fromUser: {
          select: { id: true, fullName: true, age: true },
        },
      },
    });

    const matches = mutual
      .filter((m) => !blocked.has(m.fromUser.id))
      .map((m) => ({
        id: m.fromUser.id,
        displayName: firstName(m.fromUser.fullName),
        age: m.fromUser.age,
        matchedAt: m.createdAt.toISOString(),
      }));

    res.json({ matches });
  } catch {
    res.status(500).json({ error: "Failed to fetch matches" });
  }
});

/** POST /block/:userId */
router.post("/block/:targetUserId", async (req, res) => {
  try {
    const userId = req.user!.userId;
    const targetUserId = req.params.targetUserId;
    if (targetUserId === userId) {
      res.status(400).json({ error: "Invalid block target" });
      return;
    }

    await prisma.$transaction([
      prisma.nearbyBlock.upsert({
        where: {
          blockerId_blockedId: { blockerId: userId, blockedId: targetUserId },
        },
        create: { blockerId: userId, blockedId: targetUserId },
        update: {},
      }),
      prisma.nearbyInterest.deleteMany({
        where: {
          OR: [
            { fromUserId: userId, toUserId: targetUserId },
            { fromUserId: targetUserId, toUserId: userId },
          ],
        },
      }),
    ]);

    res.json({ message: "User blocked" });
  } catch {
    res.status(500).json({ error: "Failed to block user" });
  }
});

const reportSchema = z.object({
  reason: z.string().max(500).optional(),
});

/** POST /report/:userId */
router.post("/report/:targetUserId", async (req, res) => {
  try {
    const userId = req.user!.userId;
    const targetUserId = req.params.targetUserId;
    const body = reportSchema.parse(req.body ?? {});

    await prisma.nearbyReport.create({
      data: {
        reporterId: userId,
        reportedId: targetUserId,
        reason: body.reason,
      },
    });

    res.json({ message: "Report submitted" });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.status(500).json({ error: "Failed to submit report" });
  }
});

export default router;
