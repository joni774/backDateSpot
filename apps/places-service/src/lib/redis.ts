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

export const PLACES_LIST_KEY = "places:list";
export const PLACES_LIST_TTL = 120; // 2 minutes
