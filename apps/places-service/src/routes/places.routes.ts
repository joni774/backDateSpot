import { createPlacesRouter, type PlacesListCache } from "@datespot/places-logic";
import { getRedis } from "../lib/redis";
import { optionalAuth, verifyTokenMiddleware } from "../middleware/auth.middleware";

const cache: PlacesListCache = {
  async get(key) {
    const redis = getRedis();
    if (!redis) return null;
    return redis.get(key);
  },
  async set(key, value, ttlSeconds) {
    const redis = getRedis();
    if (!redis) return;
    await redis.set(key, value, "EX", ttlSeconds);
  },
};

export default createPlacesRouter({
  optionalAuth,
  verifyTokenMiddleware,
  cache,
});
