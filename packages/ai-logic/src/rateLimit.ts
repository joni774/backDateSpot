export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

const DEFAULT_MAX = 20;
const DEFAULT_WINDOW_SEC = 60;

/**
 * Redis-backed (or in-memory) burst limiter for /chat (policy §4.3).
 * Key: ai:rl:{userId}:{minuteBucket}
 */
export async function checkChatRateLimit(
  store: RateLimitStore | null,
  userId: string,
  opts?: { maxPerWindow?: number; windowSeconds?: number }
): Promise<RateLimitResult> {
  const max = opts?.maxPerWindow ?? DEFAULT_MAX;
  const windowSec = opts?.windowSeconds ?? DEFAULT_WINDOW_SEC;

  if (!store) {
    return { allowed: true, remaining: max };
  }

  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const key = `ai:rl:${userId}:${bucket}`;
  const count = await store.incr(key);
  if (count === 1) {
    await store.expire(key, windowSec + 5);
  }
  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
  };
}

/** Simple in-memory fallback when Redis is unavailable (monolith local). */
export function createMemoryRateLimitStore(): RateLimitStore {
  const counts = new Map<string, { n: number; expiresAt: number }>();
  return {
    async incr(key) {
      const now = Date.now();
      const cur = counts.get(key);
      if (!cur || cur.expiresAt < now) {
        counts.set(key, { n: 1, expiresAt: now + 70_000 });
        return 1;
      }
      cur.n += 1;
      return cur.n;
    },
    async expire(key, ttlSeconds) {
      const cur = counts.get(key);
      if (cur) cur.expiresAt = Date.now() + ttlSeconds * 1000;
    },
  };
}
