import { prisma } from "@datespot/database";
import { Router, type RequestHandler } from "express";
import { z } from "zod";

import { fallbackResponse } from "../fallback";
import { classifyRelevance } from "../filters/preFilter";
import { postFilterOutput } from "../filters/postFilter";
import { logSecurityBlock } from "../logging";
import {
  createOpenAiClient,
  type OpenAiClient,
  type OpenAiClientConfig,
} from "../llm/openaiClient";
import {
  checkChatRateLimit,
  createMemoryRateLimitStore,
  type RateLimitStore,
} from "../rateLimit";
import {
  applyQuickModeDefaults,
  botPrompt,
  buildRecommendations,
  findRecommendedPlaces,
  formatQuickModeIntro,
  formatRecommendationsIntro,
  getFreeDailyLimit,
  getIsraelDayKey,
  getQuickReplies,
  hasUnlimitedAi,
  noResultsMessage,
  parseQuickMode,
  quotaExceededMessage,
  quickReplyLabel,
  resolveReplyLanguage,
  type AiContext,
  type AiLanguage,
  type AiStep,
} from "../recommender";

export interface AiRouterConfig {
  verifyTokenMiddleware: RequestHandler;
  openai?: OpenAiClientConfig | null;
  rateLimitStore?: RateLimitStore | null;
  publicApiUrl?: string;
}

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

function findManyPlaces(where: {
  isActive: boolean;
  category?: import("@datespot/database").PlaceCategory;
  priceRange?: import("@datespot/database").PriceRange;
}) {
  return prisma.place.findMany({ where });
}

export function createAiRouter(config: AiRouterConfig): Router {
  const router = Router();
  router.use(config.verifyTokenMiddleware);

  const openai: OpenAiClient | null = createOpenAiClient(config.openai ?? null);
  const rateStore =
    config.rateLimitStore === undefined
      ? createMemoryRateLimitStore()
      : config.rateLimitStore;

  if (config.publicApiUrl) {
    process.env.PUBLIC_API_URL = config.publicApiUrl;
  }

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
      const unlimited = hasUnlimitedAi(user.subscriptionTier);
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
        sessions: sessions.map((s) => ({
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
          messages: session.messages.map((m) => ({
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

  router.post("/chat", async (req, res) => {
    try {
      const body = chatSchema.parse(req.body);
      const userId = req.user!.userId;
      const lang: AiLanguage = resolveReplyLanguage(body.language, body.message);

      const rl = await checkChatRateLimit(rateStore, userId);
      if (!rl.allowed) {
        res.status(429).json({ error: "Too many requests. Please try again shortly." });
        return;
      }

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
            context: { step: "done", lat: body.lat, lng: body.lng },
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
            step: "done" as AiStep,
            quickReplies: getQuickReplies("mood", lang).map((v) => ({
              value: v,
              label: quickReplyLabel(v, lang),
            })),
          });
          return;
        }
      }

      let ctx = parseContext(session.context);
      if (body.lat != null) ctx.lat = body.lat;
      if (body.lng != null) ctx.lng = body.lng;

      await prisma.aiChatMessage.create({
        data: {
          sessionId: session.id,
          role: "user",
          content: body.message.trim(),
        },
      });

      // ── Layer 1: pre-classification ──────────────────────────────────────
      const relevance = await classifyRelevance(body.message, openai);
      if (relevance === "NOT_RELEVANT") {
        await logSecurityBlock({
          userId,
          sessionId: session.id,
          layer: "PRE_FILTER",
          reason: "not_relevant",
          rawMessage: body.message,
        });
        const content = fallbackResponse(lang);
        const assistantMsg = await prisma.aiChatMessage.create({
          data: {
            sessionId: session.id,
            role: "assistant",
            content,
          },
        });
        res.json({
          sessionId: session.id,
          message: {
            id: assistantMsg.id,
            role: "assistant",
            content,
            recommendations: null,
          },
          step: "done" as AiStep,
          quickReplies: [],
          advanced: false,
          quotaExceeded: false,
        });
        return;
      }

      let assistantContent = "";
      let recommendations = null;
      let step: AiStep = "done";
      let quotaExceeded = false;
      let advanced = true;

      const quickMode = parseQuickMode(body.message);
      const allowQuickMode =
        !!quickMode &&
        (body.message.trim().toLowerCase().startsWith("mode:") ||
          ctx.step === "mood" ||
          ctx.step === "done");

      if (allowQuickMode && quickMode) {
        // Deterministic zero-LLM fast path (kept from legacy wizard)
        if (!hasUnlimitedAi(user.subscriptionTier)) {
          const used = await getUsageCount(userId);
          if (used >= getFreeDailyLimit()) {
            assistantContent = quotaExceededMessage(lang);
            quotaExceeded = true;
          }
        }

        if (!assistantContent) {
          ctx = applyQuickModeDefaults(quickMode, ctx);
          const ranked = await findRecommendedPlaces(findManyPlaces, ctx, lang);
          recommendations = buildRecommendations(ranked);

          if (!recommendations) {
            assistantContent = noResultsMessage(lang);
          } else {
            assistantContent = formatQuickModeIntro(quickMode, lang);
            if (!hasUnlimitedAi(user.subscriptionTier)) {
              await incrementUsage(userId);
              quotaExceeded =
                (await getUsageCount(userId)) >= getFreeDailyLimit();
            }
          }
        }
      } else if (openai) {
        // ── Layer 2: LLM agent ─────────────────────────────────────────────
        if (!hasUnlimitedAi(user.subscriptionTier)) {
          const used = await getUsageCount(userId);
          if (used >= getFreeDailyLimit()) {
            assistantContent = quotaExceededMessage(lang);
            quotaExceeded = true;
          }
        }

        if (!assistantContent) {
          const prior = await prisma.aiChatMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: "asc" },
            take: 16,
            select: { role: true, content: true },
          });
          const history = prior
            .slice(0, -1)
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }));

          const agentResult = await openai.runAgent({
            language: lang,
            userMessage: body.message.trim(),
            history,
            findMany: findManyPlaces,
            lat: ctx.lat,
            lng: ctx.lng,
          });

          assistantContent = agentResult.content;
          recommendations = agentResult.recommendations;

          if (recommendations && !hasUnlimitedAi(user.subscriptionTier)) {
            await incrementUsage(userId);
            quotaExceeded =
              (await getUsageCount(userId)) >= getFreeDailyLimit();
          }

          if (!assistantContent && recommendations) {
            assistantContent = formatRecommendationsIntro(
              lang,
              ctx.partySize ?? 2
            );
          }
        }
      } else {
        // No OpenAI key: stay on-topic with a friendly redirect (not a security block)
        assistantContent = fallbackResponse(lang);
        advanced = false;
      }

      // ── Layer 3: post-filter ─────────────────────────────────────────────
      const pf = postFilterOutput(assistantContent);
      if (pf.blocked) {
        await logSecurityBlock({
          userId,
          sessionId: session.id,
          layer: "POST_FILTER",
          reason: pf.reason ?? "blocked",
          rawMessage: assistantContent,
        });
        assistantContent = fallbackResponse(lang);
        recommendations = null;
      }

      ctx = {
        ...ctx,
        step: "done",
        lat: ctx.lat,
        lng: ctx.lng,
      };

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
          recommendations: recommendations
            ? (recommendations as object)
            : undefined,
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
        quickReplies: getQuickReplies("mood", lang).map((v) => ({
          value: v,
          label: quickReplyLabel(v, lang),
        })),
        advanced,
        quotaExceeded,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          error: err.errors[0]?.message ?? "Invalid input",
        });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to process chat" });
    }
  });

  return router;
}
