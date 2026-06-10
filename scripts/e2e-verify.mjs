#!/usr/bin/env node
/**
 * Local E2E smoke test for DateSpot API.
 * Prerequisites: API running on PORT (default 3000), db migrated + seeded.
 * Usage: node scripts/e2e-verify.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? process.env.API_URL ?? "http://localhost:3000";

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
    failed++;
  }
}

async function json(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  console.log(`E2E verify against ${BASE}\n`);

  let adminToken;
  let places;

  await check("GET /health", async () => {
    const data = await json("/health");
    if (data.status !== "ok") throw new Error("unexpected health response");
  });

  await check("POST /api/auth/login (admin)", async () => {
    const data = await json("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "admin@datespot.co.il",
        password: "admin123",
      }),
    });
    if (!data.token) throw new Error("no token");
    adminToken = data.token;
  });

  await check("GET /api/places (public)", async () => {
    const data = await json("/api/places?lat=32.0853&lng=34.7818&language=he");
    places = data.places;
    if (!Array.isArray(places) || places.length === 0) {
      throw new Error("expected seeded places");
    }
  });

  await check("FREE tier lock indicator (place 6+)", async () => {
    if (places.length < 6) return;
    const locked = places.slice(5).some((p) => p.isLocked === true);
    if (!locked) throw new Error("expected isLocked on places 6+ for anonymous/FREE");
  });

  await check("GET /api/places/:id", async () => {
    const detail = await json(`/api/places/${places[0].id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (typeof detail.isOpen !== "boolean") {
      throw new Error("expected isOpen field");
    }
  });

  await check("GET /api/admin/stats", async () => {
    const stats = await json("/api/admin/stats", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (typeof stats.totalPlaces !== "number") {
      throw new Error("expected totalPlaces");
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
