import {
  createAiRouter,
  createMemoryRateLimitStore,
  type RateLimitStore,
} from "@datespot/ai-logic";
import { env } from "../config/env";
import { getRedis } from "../lib/redis";
import { verifyTokenMiddleware } from "../middleware/auth.middleware";

function createRedisRateLimitStore(): RateLimitStore | null {
  const redis = getRedis();
  if (!redis) return null;
  return {
    async incr(key) {
      return redis.incr(key);
    },
    async expire(key, ttlSeconds) {
      await redis.expire(key, ttlSeconds);
    },
  };
}

const rateLimitStore =
  createRedisRateLimitStore() ?? createMemoryRateLimitStore();

export default createAiRouter({
  verifyTokenMiddleware,
  openai: env.OPENAI_API_KEY
    ? {
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
        classifierModel: env.OPENAI_CLASSIFIER_MODEL,
      }
    : null,
  rateLimitStore,
  publicApiUrl: env.PUBLIC_API_URL,
});
