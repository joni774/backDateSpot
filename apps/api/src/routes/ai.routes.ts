/** AI date planner — conversational recommendations from places DB. */
import { prisma, type PlaceCategory, type PriceRange } from "@datespot/database";
import { Router } from "express";
import { z } from "zod";

import {
  applyQuickModeDefaults,
  botPrompt,
  botRetry,
  buildRecommendations,
  findRecommendedPlaces,
  formatQuickModeIntro,
  formatRecommendationsIntro,
  getFreeDailyLimit,
  getIsraelDayKey,
  getQuickReplies,
  moodToDefaultCategory,
  noResultsMessage,
  parseBudget,
  parseCategory,
  parseMood,
  parsePartySize,
  parseQuickMode,
  parseRadius,
  quotaExceededMessage,
  quickReplyLabel,
  resolveReplyLanguage,
  type AiContext,
  type AiLanguage,
  type AiStep,
} from "../ai/ai.recommender";
import { verifyTokenMiddleware } from "../middleware/auth.middleware";

const router = Router();
router.use(verifyTokenMiddleware);

const chatSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(500),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  language: z.string().optional(),
});

function parseContext(raw: unknown): AiContext {
  const base: AiContext = { step: "mood" };
  if (!raw || typeof raw !== "object") return base;
  return { ...base, ...(raw as AiContext) };
}

async function getUsageCount(userId: string): Promise<number> {
  const day = getIsraelDayKey();
  const row = await prisma.aiDailyUsage.findUnique({
    where: { userId_day: { userId, day } },
  });
  return row?.count ?? 0;
}

async function incrementUsage(userId: string): Promise<void> {
  const day = getIsraelDayKey();
  await prisma.aiDailyUsage.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: 1 },
    update: { count: { increment: 1 } },
  });
}

function nextStep(current: AiStep): AiStep {
  const order: AiStep[] = ["mood", "category", "budget", "radius", "partySize", "done"];
  const idx = order.indexOf(current);
  return order[Math.min(idx + 1, order.length - 1)];
}

/** GET /quota */
router.get("/quota", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { subscriptionTier: true },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const unlimited = user.subscriptionTier !== "FREE";
    const used = await getUsageCount(req.user!.userId);
    const limit = getFreeDailyLimit();
    res.json({
      unlimited,
      used,
      limit,
      remaining: unlimited ? null : Math.max(0, limit - used),
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch quota" });
  }
});

/** GET /sessions */
router.get("/sessions", async (req, res) => {
  try {
    const sessions = await prisma.aiChatSession.findMany({
      where: { userId: req.user!.userId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        language: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { content: true },
        },
      },
    });
    res.json({
      sessions: sessions.map((s: (typeof sessions)[number]) => ({
        id: s.id,
        language: s.language,
        preview: s.messages[0]?.content ?? "",
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

/** GET /sessions/:id */
router.get("/sessions/:id", async (req, res) => {
  try {
    const session = await prisma.aiChatSession.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({
      session: {
        id: session.id,
        language: session.language,
        context: session.context,
        messages: session.messages.map((m: (typeof session.messages)[number]) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          recommendations: m.recommendations,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

/** POST /chat */
router.post("/chat", async (req, res) => {
  try {
    const body = chatSchema.parse(req.body);
    const userId = req.user!.userId;
    const lang: AiLanguage = resolveReplyLanguage(body.language, body.message);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let session = body.sessionId
      ? await prisma.aiChatSession.findFirst({
          where: { id: body.sessionId, userId },
        })
      : null;

    if (body.sessionId && !session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (!session) {
      session = await prisma.aiChatSession.create({
        data: {
          userId,
          language: lang,
          context: { step: "mood", lat: body.lat, lng: body.lng },
        },
      });
      const welcome = botPrompt("mood", lang);
      await prisma.aiChatMessage.create({
        data: { sessionId: session.id, role: "assistant", content: welcome },
      });

      const isStartOnly = ["start", "התחל", "ابدأ", "inicio"].includes(
        body.message.trim().toLowerCase()
      );

      if (isStartOnly) {
        res.json({
          sessionId: session.id,
          message: {
            role: "assistant",
            content: welcome,
            recommendations: null,
          },
          step: "mood" as AiStep,
          quickReplies: getQuickReplies("mood", lang).map((v) => ({
            value: v,
            label: quickReplyLabel(v, lang),
          })),
        });
        return;
      }
      // fall through — process first user message in same request
    }

    let ctx = parseContext(session.context);
    if (body.lat != null) ctx.lat = body.lat;
    if (body.lng != null) ctx.lng = body.lng;

    await prisma.aiChatMessage.create({
      data: { sessionId: session.id, role: "user", content: body.message.trim() },
    });

    if (ctx.step === "done") {
      ctx = { step: "mood", lat: ctx.lat, lng: ctx.lng };
    }

    let advanced = false;
    let assistantContent = "";
    let recommendations = null;
    let step = ctx.step;

    const quickMode = parseQuickMode(body.message);
    const allowQuickMode =
      !!quickMode &&
      (body.message.trim().toLowerCase().startsWith("mode:") ||
        ctx.step === "mood" ||
        ctx.step === "done");

    if (allowQuickMode && quickMode) {
      if (user.subscriptionTier === "FREE") {
        const used = await getUsageCount(userId);
        if (used >= getFreeDailyLimit()) {
          assistantContent = quotaExceededMessage(lang);
          ctx.step = "done";
          step = "done";
        }
      }

      if (!assistantContent) {
        ctx = applyQuickModeDefaults(quickMode, ctx);
        const ranked = await findRecommendedPlaces(
          (where) => prisma.place.findMany({ where }),
          ctx,
          lang
        );
        recommendations = buildRecommendations(ranked);

        if (!recommendations) {
          assistantContent = noResultsMessage(lang);
        } else {
          assistantContent = formatQuickModeIntro(quickMode, lang);
          if (user.subscriptionTier === "FREE") {
            await incrementUsage(userId);
          }
        }
        step = "done";
        advanced = true;
      }
    } else switch (ctx.step) {
      case "mood": {
        const mood = parseMood(body.message);
        if (!mood) {
          assistantContent = botRetry("mood", lang);
        } else {
          ctx.mood = mood;
          ctx.category = moodToDefaultCategory(mood);
          step = nextStep("mood");
          ctx.step = step;
          assistantContent = botPrompt(step, lang);
          advanced = true;
        }
        break;
      }
      case "category": {
        const category = parseCategory(body.message);
        if (!category) {
          assistantContent = botRetry("category", lang);
        } else {
          ctx.category = category;
          step = nextStep("category");
          ctx.step = step;
          assistantContent = botPrompt(step, lang);
          advanced = true;
        }
        break;
      }
      case "budget": {
        const budget = parseBudget(body.message);
        if (!budget) {
          assistantContent = botRetry("budget", lang);
        } else {
          ctx.budget = budget;
          step = nextStep("budget");
          ctx.step = step;
          assistantContent = botPrompt(step, lang);
          advanced = true;
        }
        break;
      }
      case "radius": {
        const radiusKm = parseRadius(body.message);
        if (!radiusKm) {
          assistantContent = botRetry("radius", lang);
        } else {
          ctx.radiusKm = radiusKm;
          step = nextStep("radius");
          ctx.step = step;
          assistantContent = botPrompt(step, lang);
          advanced = true;
        }
        break;
      }
      case "partySize": {
        const partySize = parsePartySize(body.message);
        if (!partySize) {
          assistantContent = botRetry("partySize", lang);
        } else {
          ctx.partySize = partySize;

          if (user.subscriptionTier === "FREE") {
            const used = await getUsageCount(userId);
            if (used >= getFreeDailyLimit()) {
              assistantContent = quotaExceededMessage(lang);
              ctx.step = "done";
              step = "done";
              break;
            }
          }

          const ranked = await findRecommendedPlaces(
            (where) => prisma.place.findMany({ where }),
            ctx,
            lang
          );
          recommendations = buildRecommendations(ranked);

          if (!recommendations) {
            assistantContent = noResultsMessage(lang);
          } else {
            assistantContent = formatRecommendationsIntro(lang, partySize);
            if (user.subscriptionTier === "FREE") {
              await incrementUsage(userId);
            }
          }
          ctx.step = "done";
          step = "done";
          advanced = true;
        }
        break;
      }
      default:
        ctx = { step: "mood", lat: ctx.lat, lng: ctx.lng };
        step = "mood";
        assistantContent = botPrompt("mood", lang);
        advanced = true;
    }

    await prisma.aiChatSession.update({
      where: { id: session.id },
      data: {
        context: ctx as object,
        language: lang,
        updatedAt: new Date(),
      },
    });

    const assistantMsg = await prisma.aiChatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: assistantContent,
        recommendations: recommendations ? (recommendations as object) : undefined,
      },
    });

    res.json({
      sessionId: session.id,
      message: {
        id: assistantMsg.id,
        role: "assistant",
        content: assistantContent,
        recommendations,
      },
      step,
      quickReplies:
        step !== "done" && step !== "partySize"
          ? getQuickReplies(step, lang).map((v) => ({
              value: v,
              label: quickReplyLabel(v, lang),
            }))
          : [],
      advanced,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message ?? "Invalid input" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to process chat" });
  }
});

export default router;
