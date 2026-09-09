/**
 * Best-effort delivery marketplace availability matching.
 * Wolt may return AVAILABLE via public discovery HTML; 10bis / Mishloha often stay UNKNOWN
 * (no official public directory API) — admin confirmation is the source of truth.
 */
import type { Place, DeliveryAvailability, PlaceCategory } from "@datespot/database";
import { stripBusinessNameNoise } from "./google-places";
import { FOOD_CATEGORIES } from "./place-image-sources";
import { updatePlaceDeliveryStatusSafe } from "./place-query-safe";

export type DeliveryPlatformId = "wolt" | "tenbis" | "mishloha";

export type DeliveryMatchResult = {
  status: DeliveryAvailability;
  url: string | null;
  confidence: number;
  reason?: string;
};

export type PlaceDeliveryCheckResult = {
  wolt: DeliveryMatchResult;
  tenbis: DeliveryMatchResult;
  mishloha: DeliveryMatchResult;
};

function normalizeName(value: string): string {
  return stripBusinessNameNoise(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function namesMatch(candidate: string, targetHe: string, targetEn: string): boolean {
  const cand = normalizeName(candidate);
  if (!cand) return false;
  const targets = [targetHe, targetEn].map(normalizeName).filter(Boolean);
  for (const target of targets) {
    if (cand === target) return true;
    if (cand.includes(target) || target.includes(cand)) return true;
    const candTokens = new Set(cand.split(" ").filter((t) => t.length > 1));
    const targetTokens = target.split(" ").filter((t) => t.length > 1);
    if (targetTokens.length === 0) continue;
    const overlap = targetTokens.filter((t) => candTokens.has(t)).length;
    if (overlap / targetTokens.length >= 0.7) return true;
  }
  return false;
}

function extractUrls(html: string): string[] {
  const urls = new Set<string>();
  const re = /https?:\/\/[^\s"'<>]+/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    urls.add(match[0].replace(/[),.;]+$/, ""));
  }
  return [...urls];
}

function isWoltVenueUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("wolt.com")) return false;
    const path = u.pathname.toLowerCase();
    if (path.includes("gift-card") || path.includes("/discovery") || path.includes("/help")) {
      return false;
    }
    // Real venue pages look like /he/isr/<city>/restaurant/<slug> or /venue/
    return path.includes("/restaurant/") || path.includes("/venue/");
  } catch {
    return false;
  }
}

function extractJsonBlobNames(html: string): Array<{ name: string; url?: string }> {
  const out: Array<{ name: string; url?: string }> = [];
  // Common SSR patterns: "name":"...", "title":"..."
  const nameRe = /"(?:name|title|venue_name|restaurantName)"\s*:\s*"([^"\\]{2,120})"/gi;
  let match: RegExpExecArray | null;
  while ((match = nameRe.exec(html))) {
    out.push({ name: match[1] });
  }
  const urlNameRe =
    /"(?:url|permalink|slug)"\s*:\s*"(https?:\\\/\\\/[^"\\]+|\/[^"\\]{3,200})"/gi;
  while ((match = urlNameRe.exec(html))) {
    const raw = match[1].replace(/\\\//g, "/");
    const url = raw.startsWith("http") ? raw : `https://wolt.com${raw}`;
    out.push({ name: decodeURIComponent(raw.split("/").pop() ?? ""), url });
  }
  return out;
}

/** Best-effort Wolt discovery page match. */
export async function matchWoltListing(options: {
  nameHe: string;
  nameEn: string;
  latitude: number;
  longitude: number;
}): Promise<DeliveryMatchResult> {
  const query = options.nameHe.trim() || options.nameEn.trim();
  if (!query) {
    return { status: "UNKNOWN", url: null, confidence: 0, reason: "empty_name" };
  }

  const discoveryUrl = `https://wolt.com/he/discovery?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(discoveryUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; DateSpotBot/1.0; +https://datespot.co.il)",
        Accept: "text/html,application/json",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        status: "UNKNOWN",
        url: null,
        confidence: 0,
        reason: `http_${res.status}`,
      };
    }
    const html = await res.text();
    const venueUrls = extractUrls(html).filter(isWoltVenueUrl);
    const blobs = extractJsonBlobNames(html);

    // Require a real venue deep-link — never city hubs / gift-card / discovery.
    for (const item of blobs) {
      if (!namesMatch(item.name, options.nameHe, options.nameEn)) continue;
      const url =
        (item.url && isWoltVenueUrl(item.url) ? item.url : null) ??
        venueUrls.find((u) => {
          const slug = decodeURIComponent(u.split("/").pop() ?? "").replace(/-/g, " ");
          return namesMatch(slug, options.nameHe, options.nameEn);
        }) ??
        null;
      if (!url) continue;
      return { status: "AVAILABLE", url, confidence: 0.75, reason: "name_match" };
    }

    // Heuristic: restaurant deep-links in HTML containing normalized tokens
    const tokens = normalizeName(query).split(" ").filter((t) => t.length > 2);
    // Short / generic names (e.g. "Go") produce too many false positives.
    if (tokens.length === 0 || normalizeName(query).length < 4) {
      return { status: "UNKNOWN", url: null, confidence: 0.1, reason: "name_too_short" };
    }
    for (const url of venueUrls) {
      const slug = decodeURIComponent(url.split("/").pop() ?? "").replace(/-/g, " ");
      if (namesMatch(slug, options.nameHe, options.nameEn)) {
        return { status: "AVAILABLE", url, confidence: 0.65, reason: "slug_match" };
      }
      if (tokens.length >= 2 && tokens.every((t) => slug.includes(t))) {
        return { status: "AVAILABLE", url, confidence: 0.55, reason: "slug_tokens" };
      }
    }

    return { status: "UNKNOWN", url: null, confidence: 0.2, reason: "no_match" };
  } catch (err) {
    console.warn("[delivery] Wolt match failed:", err);
    return { status: "UNKNOWN", url: null, confidence: 0, reason: "fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}

/** 10bis has no reliable public directory API — leave UNKNOWN for admin review. */
export async function matchTenBisListing(_options: {
  nameHe: string;
  nameEn: string;
  latitude: number;
  longitude: number;
}): Promise<DeliveryMatchResult> {
  return {
    status: "UNKNOWN",
    url: null,
    confidence: 0,
    reason: "no_public_api",
  };
}

/** Mishloha has no reliable public directory API — leave UNKNOWN for admin review. */
export async function matchMishlohaListing(_options: {
  nameHe: string;
  nameEn: string;
  latitude: number;
  longitude: number;
}): Promise<DeliveryMatchResult> {
  return {
    status: "UNKNOWN",
    url: null,
    confidence: 0,
    reason: "no_public_api",
  };
}

export async function checkDeliveryAvailabilityForPlace(place: {
  nameHe: string;
  nameEn: string;
  latitude: number;
  longitude: number;
  deliveryWoltUrl?: string | null;
  deliveryTenBisUrl?: string | null;
  deliveryMishlohaUrl?: string | null;
}): Promise<PlaceDeliveryCheckResult> {
  const [wolt, tenbis, mishloha] = await Promise.all([
    matchWoltListing(place),
    matchTenBisListing(place),
    matchMishlohaListing(place),
  ]);

  // Prefer existing admin URLs when matcher is uncertain — but only if the URL looks real.
  if (
    place.deliveryWoltUrl &&
    isWoltVenueUrl(place.deliveryWoltUrl) &&
    wolt.status !== "AVAILABLE"
  ) {
    wolt.status = "AVAILABLE";
    wolt.url = place.deliveryWoltUrl;
    wolt.confidence = Math.max(wolt.confidence, 0.9);
    wolt.reason = "existing_url";
  } else if (place.deliveryWoltUrl && !isWoltVenueUrl(place.deliveryWoltUrl) && wolt.status !== "AVAILABLE") {
    // Drop false-positive city/gift hubs left by earlier matcher versions.
    wolt.status = "UNKNOWN";
    wolt.url = null;
    wolt.reason = "invalid_existing_url";
  }
  if (place.deliveryTenBisUrl && tenbis.status !== "AVAILABLE") {
    tenbis.status = "AVAILABLE";
    tenbis.url = place.deliveryTenBisUrl;
    tenbis.confidence = Math.max(tenbis.confidence, 0.9);
    tenbis.reason = "existing_url";
  }
  if (place.deliveryMishlohaUrl && mishloha.status !== "AVAILABLE") {
    mishloha.status = "AVAILABLE";
    mishloha.url = place.deliveryMishlohaUrl;
    mishloha.confidence = Math.max(mishloha.confidence, 0.9);
    mishloha.reason = "existing_url";
  }

  return { wolt, tenbis, mishloha };
}

export type ResolvedDeliveryProvider = {
  available: boolean;
  url: string | null;
  status: DeliveryAvailability;
};

export type ResolvedDeliveryProviders = {
  wolt: ResolvedDeliveryProvider;
  tenbis: ResolvedDeliveryProvider;
  mishloha: ResolvedDeliveryProvider;
};

function resolveOne(
  status: DeliveryAvailability | string | null | undefined,
  url: string | null | undefined
): ResolvedDeliveryProvider {
  const normalized = (status ?? "UNKNOWN") as DeliveryAvailability;
  const available = normalized === "AVAILABLE";
  return {
    available,
    status: normalized,
    url: available && url ? url : null,
  };
}

/** Public API shape — only AVAILABLE providers are actionable. */
export function resolveDeliveryProviders(place: {
  deliveryWoltStatus?: DeliveryAvailability | string | null;
  deliveryTenBisStatus?: DeliveryAvailability | string | null;
  deliveryMishlohaStatus?: DeliveryAvailability | string | null;
  deliveryWoltUrl?: string | null;
  deliveryTenBisUrl?: string | null;
  deliveryMishlohaUrl?: string | null;
}): ResolvedDeliveryProviders {
  return {
    wolt: resolveOne(place.deliveryWoltStatus, place.deliveryWoltUrl),
    tenbis: resolveOne(place.deliveryTenBisStatus, place.deliveryTenBisUrl),
    mishloha: resolveOne(place.deliveryMishlohaStatus, place.deliveryMishlohaUrl),
  };
}

export function isFoodDeliveryCategory(category: PlaceCategory): boolean {
  return FOOD_CATEGORIES.has(category) || category === "ROMANTIC_DATE";
}

/** Persist matcher results; does not mark admin-confirmed. */
export async function persistDeliveryCheckResult(
  placeId: string,
  result: PlaceDeliveryCheckResult
): Promise<void> {
  await updatePlaceDeliveryStatusSafe({
    placeId,
    deliveryWoltStatus: result.wolt.status,
    deliveryTenBisStatus: result.tenbis.status,
    deliveryMishlohaStatus: result.mishloha.status,
    deliveryWoltUrl: result.wolt.url,
    deliveryTenBisUrl: result.tenbis.url,
    deliveryMishlohaUrl: result.mishloha.url,
    deliveryStatusConfirmedByAdmin: false,
    deliveryStatusCheckedAt: new Date(),
  });
}

export function placeNeedsDeliveryCheck(place: Place): boolean {
  if (!isFoodDeliveryCategory(place.category)) return false;
  if (!place.isActive) return false;
  return (
    place.deliveryWoltStatus === "UNKNOWN" ||
    place.deliveryTenBisStatus === "UNKNOWN" ||
    place.deliveryMishlohaStatus === "UNKNOWN" ||
    !place.deliveryStatusConfirmedByAdmin
  );
}
