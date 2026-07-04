import Redis from "ioredis";
import { env } from "../config/env";

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(env.REDIS_URL);
    redis.on("error", (err) => console.error("[Redis] connection error:", err));
  }
  return redis;
}

/** Invalidate all places list cache keys (pattern: places:list:*). */
export async function invalidatePlacesCache(): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const keys = await r.keys("places:list:*");
  if (keys.length > 0) await r.del(...keys);
}
