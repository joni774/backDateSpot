import type { Place, PlaceCategory, PriceRange } from "@datespot/database";
import { getDistanceKm } from "@datespot/utils";
import { isPlaceOpenNow, localizePlace } from "@datespot/places-logic";

export type AiLanguage = "he" | "en" | "ar";
export type AiStep = "mood" | "category" | "budget" | "radius" | "partySize" | "done";

const AI_LANGUAGES = new Set<AiLanguage>(["he", "en", "ar"]);

/** Normalize app / Accept-Language style codes ("he-IL", "en_US") → he|en|ar. */
export function normalizeAiLanguage(raw?: string | null): AiLanguage {
  if (!raw) return "he";
  const base = raw.toLowerCase().split(/[-_]/)[0]?.trim();
  if (base && AI_LANGUAGES.has(base as AiLanguage)) {
    return base as AiLanguage;
  }
  return "he";
}

export interface AiContext {
  step: AiStep;
  mood?: string;
  category?: PlaceCategory;
  budget?: PriceRange;
  radiusKm?: number;
  partySize?: number;
  lat?: number;
  lng?: number;
}

export interface AiPlaceRecommendation {
  id: string;
  name: string;
  description: string;
  category: PlaceCategory;
  priceRange: PriceRange;
  distanceKm: number | null;
  isOpen: boolean;
}

export interface AiRecommendations {
  primary: AiPlaceRecommendation;
  alternatives: AiPlaceRecommendation[];
}

const FREE_DAILY_LIMIT = 3;

const MOOD_KEYWORDS: Record<string, string[]> = {
  romantic: ["רומנטי", "romantic", "דייט", "date", "love", "אהבה"],
  fun: ["כיף", "fun", "בילוי", "party", "חגיג"],
  relaxed: ["רגוע", "relaxed", "שקט", "quiet", " chill"],
  celebrate: ["לחגוג", "celebrate", "birthday", "יום הולדת", "special"],
};

const CATEGORY_KEYWORDS: Record<PlaceCategory, string[]> = {
  ROMANTIC_DATE: ["רומנטי", "romantic", "דייט", "date"],
  RESTAURANT: ["מסעד", "restaurant", "אוכל", "food"],
  DAIRY_RESTAURANT: ["חלב", "dairy", "כשר"],
  MEAT_RESTAURANT: ["בשר", "meat", "steak", "גריל"],
  SUSHI: ["סושי", "sushi", "יפני", "japanese"],
  SUNSET: ["שקיע", "sunset", "נוף", "view"],
  ATTRACTION: ["אטרקצ", "attraction", "בילוי", "activity", "fun"],
};

const BUDGET_KEYWORDS: Record<PriceRange, string[]> = {
  FREE: ["חינם", "free", "0", "budget:free"],
  BUDGET: ["זול", "budget", "₪", "cheap", "budget:budget"],
  MODERATE: ["בינונ", "moderate", "₪₪", "budget:moderate"],
  EXPENSIVE: ["יקר", "expensive", "₪₪₪", "fancy", "budget:expensive"],
};

export function getIsraelDayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export function getFreeDailyLimit(): number {
  return FREE_DAILY_LIMIT;
}

function includesKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

function parsePrefixed(value: string, prefix: string): string | null {
  if (value.toLowerCase().startsWith(`${prefix}:`)) {
    return value.slice(prefix.length + 1).trim();
  }
  return null;
}

export function parseMood(text: string): string | undefined {
  const pref = parsePrefixed(text, "mood");
  if (pref) return pref;
  for (const [mood, keys] of Object.entries(MOOD_KEYWORDS)) {
    if (includesKeyword(text, keys)) return mood;
  }
  return undefined;
}

export function parseCategory(text: string): PlaceCategory | undefined {
  const pref = parsePrefixed(text, "category") as PlaceCategory | null;
  if (pref && pref in CATEGORY_KEYWORDS) return pref;
  for (const [cat, keys] of Object.entries(CATEGORY_KEYWORDS) as [PlaceCategory, string[]][]) {
    if (includesKeyword(text, keys)) return cat;
  }
  return undefined;
}

export function parseBudget(text: string): PriceRange | undefined {
  const pref = parsePrefixed(text, "budget") as PriceRange | null;
  if (pref && pref in BUDGET_KEYWORDS) return pref;
  for (const [range, keys] of Object.entries(BUDGET_KEYWORDS) as [PriceRange, string[]][]) {
    if (includesKeyword(text, keys)) return range;
  }
  return undefined;
}

export function parseRadius(text: string): number | undefined {
  const pref = parsePrefixed(text, "radius");
  if (pref) {
    const n = Number(pref);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const match = text.match(/(\d+)\s*(?:km|ק"?מ|קילומטר)/i) ?? text.match(/^(\d+)$/);
  if (match) {
    const n = Number(match[1]);
    if (n > 0 && n <= 50) return n;
  }
  if (includesKeyword(text, ["2", "קרוב", "near", "radius:2"])) return 2;
  if (includesKeyword(text, ["5", "radius:5"])) return 5;
  if (includesKeyword(text, ["10", "radius:10"])) return 10;
  if (includesKeyword(text, ["20", "radius:20", "רחוק", "far"])) return 20;
  return undefined;
}

export function parsePartySize(text: string): number | undefined {
  const pref = parsePrefixed(text, "party");
  if (pref) {
    const n = Number(pref);
    if (!Number.isNaN(n) && n >= 1 && n <= 20) return n;
  }
  const match = text.match(/(\d+)/);
  if (match) {
    const n = Number(match[1]);
    if (n >= 1 && n <= 20) return n;
  }
  return undefined;
}

export function moodToDefaultCategory(mood: string): PlaceCategory {
  switch (mood) {
    case "romantic":
      return "ROMANTIC_DATE";
    case "fun":
    case "celebrate":
      return "ATTRACTION";
    case "relaxed":
      return "SUNSET";
    default:
      return "RESTAURANT";
  }
}

export function botPrompt(step: AiStep, lang: AiLanguage): string {
  const prompts: Record<AiLanguage, Record<AiStep, string>> = {
    he: {
      mood: "שלום! אני הבוט של DateSpot 🌙\nלאן יוצאים הערב?\n\nספר/י לי מה מצב הרוח — רומנטי, כיפי, רגוע, או לחגוג?",
      category: "מעולה! איזה סוג מקום מתאים?\nמסעדה, דייט רומנטי, סושי, שקיעה, אטרקציה, חלבית או בשרית?",
      budget: "מה התקציב?\nחינם · ₪ · ₪₪ · ₪₪₪",
      radius: "כמה רחוק מוכנים לנסוע?\n2 / 5 / 10 / 20 ק\"מ",
      partySize: "כמה אתם? (מספר סועדים)",
      done: "",
    },
    en: {
      mood: "Hi! I'm the DateSpot bot 🌙\nWhere should you go tonight?\n\nWhat's the vibe — romantic, fun, relaxed, or celebrating?",
      category: "Great! What type of place?\nRestaurant, romantic date, sushi, sunset, attraction, dairy or meat?",
      budget: "What's your budget?\nFree · ₪ · ₪₪ · ₪₪₪",
      radius: "How far are you willing to go?\n2 / 5 / 10 / 20 km",
      partySize: "How many people?",
      done: "",
    },
    ar: {
      mood: "مرحباً! أنا بوت DateSpot 🌙\nإلى أين تخرجون الليلة؟\n\nما الأجواء — رومانسي، مرح، هادئ، أم احتفال؟",
      category: "رائع! أي نوع مكان؟\nمطعم، موعد رومانسي، سوشي، غروب، جاذبية، حليبي أو لحوم؟",
      budget: "ما الميزانية؟\nمجاني · ₪ · ₪₪ · ₪₪₪",
      radius: "كم المسافة المناسبة؟\n2 / 5 / 10 / 20 كم",
      partySize: "كم عددكم؟",
      done: "",
    },
  };
  return prompts[lang][step];
}

export function botRetry(step: AiStep, lang: AiLanguage): string {
  const retries: Record<AiLanguage, Record<AiStep, string>> = {
    he: {
      mood: "לא הבנתי — נסה/י: רומנטי, כיפי, רגוע, או לחגוג",
      category: "בחר/י קטגוריה: מסעדה, דייט, סושי, שקיעה, אטרקציה...",
      budget: "בחר/י: חינם, ₪, ₪₪, או ₪₪₪",
      radius: "הקלד/י מספר ק\"מ: 2, 5, 10, או 20",
      partySize: "הקלד/י מספר (למשל 2)",
      done: "",
    },
    en: {
      mood: "Try: romantic, fun, relaxed, or celebrate",
      category: "Pick: restaurant, romantic, sushi, sunset, attraction...",
      budget: "Pick: free, ₪, ₪₪, or ₪₪₪",
      radius: "Enter km: 2, 5, 10, or 20",
      partySize: "Enter a number (e.g. 2)",
      done: "",
    },
    ar: {
      mood: "جرّب: رومانسي، مرح، هادئ، أو احتفال",
      category: "اختر: مطعم، رومانسي، سوشي، غروب...",
      budget: "اختر: مجاني، ₪، ₪₪، ₪₪₪",
      radius: "أدخل كم: 2، 5، 10، 20",
      partySize: "أدخل رقماً (مثلاً 2)",
      done: "",
    },
  };
  return retries[lang][step];
}

export function formatRecommendationsIntro(lang: AiLanguage, partySize: number): string {
  if (lang === "he") return `מצאתי מקומות מושלמים ל-${partySize}! הנה ההמלצה שלי:`;
  if (lang === "ar") return `وجدت أماكن رائعة لـ ${partySize}! إليك توصيتي:`;
  return `Found great spots for ${partySize}! Here's my pick:`;
}

export type AiQuickMode = "personal" | "hot";

export function parseQuickMode(text: string): AiQuickMode | undefined {
  const trimmed = text.trim();
  const pref = parsePrefixed(trimmed, "mode");
  if (pref === "personal" || pref === "hot") return pref;

  const lower = trimmed.toLowerCase();

  if (
    includesKeyword(lower, [
      "המלצה חמה",
      "hot pick",
      "hot recommendation",
      "توصية ساخنة",
      "עכשיו",
      "right now",
      "open now",
      "פתוח עכשיו",
      "الآن",
    ])
  ) {
    return "hot";
  }

  if (
    includesKeyword(lower, [
      "המלצה שלי",
      "המלצה",
      "תמליץ",
      "תציע",
      "הציעי",
      "המלץ",
      "לאן",
      "לאן לצאת",
      "לאן כדאי",
      "מקום לדייט",
      "דייט",
      "my pick",
      "my recommendation",
      "recommend",
      "suggestion",
      "suggest",
      "where should",
      "where to go",
      "date idea",
      "go out",
      "توصيتي",
      "توصية",
      "اقترح",
      "أين نخرج",
      "وين",
    ])
  ) {
    return "personal";
  }

  return undefined;
}

/** Instant recommend presets — skips the multi-step wizard. */
export function applyQuickModeDefaults(
  mode: AiQuickMode,
  ctx: AiContext
): AiContext {
  if (mode === "personal") {
    return {
      ...ctx,
      mood: "romantic",
      category: "ROMANTIC_DATE",
      budget: "MODERATE",
      radiusKm: 10,
      partySize: 2,
      step: "done",
    };
  }
  return {
    ...ctx,
    mood: "fun",
    category: undefined,
    budget: undefined,
    radiusKm: 15,
    partySize: 2,
    step: "done",
  };
}

export function formatQuickModeIntro(mode: AiQuickMode, lang: AiLanguage): string {
  if (mode === "personal") {
    if (lang === "he") return "הנה ההמלצה שלי לדייט מושלם לידך:";
    if (lang === "ar") return "إليك توصيتي لموعد مثالي بالقرب منك:";
    return "Here's my romantic pick near you:";
  }
  if (lang === "he") return "🔥 המלצה חמה — מקום פתוח וקרוב עכשיו:";
  if (lang === "ar") return "🔥 توصية ساخنة — مكان مفتوح وقريب الآن:";
  return "🔥 Hot pick — open and nearby right now:";
}


export function serializePlace(
  place: Place,
  language: AiLanguage,
  lat?: number,
  lng?: number
): AiPlaceRecommendation {
  const { name, description } = localizePlace(place, language);
  const distanceKm =
    lat != null && lng != null
      ? getDistanceKm(lat, lng, place.latitude, place.longitude)
      : null;
  return {
    id: place.id,
    name,
    description: description.slice(0, 120),
    category: place.category,
    priceRange: place.priceRange,
    distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
    isOpen: isPlaceOpenNow(place.openingHours),
  };
}

export function rankPlaces(
  places: Place[],
  ctx: AiContext,
  language: AiLanguage
): AiPlaceRecommendation[] {
  const lat = ctx.lat;
  const lng = ctx.lng;
  const radius = ctx.radiusKm ?? 10;

  return places
    .map((p) => ({
      place: p,
      rec: serializePlace(p, language, lat, lng),
    }))
    .filter(({ rec }) => rec.distanceKm == null || rec.distanceKm <= radius)
    .sort((a, b) => {
      if (a.rec.isOpen !== b.rec.isOpen) return a.rec.isOpen ? -1 : 1;
      const da = a.rec.distanceKm ?? 999;
      const db = b.rec.distanceKm ?? 999;
      if (da !== db) return da - db;
      return a.place.displayOrder - b.place.displayOrder;
    })
    .map(({ rec }) => rec);
}

export function buildRecommendations(
  ranked: AiPlaceRecommendation[]
): AiRecommendations | null {
  if (ranked.length === 0) return null;
  return {
    primary: ranked[0],
    alternatives: ranked.slice(1, 4),
  };
}

export function noResultsMessage(lang: AiLanguage): string {
  if (lang === "he") return "לא מצאתי מקומות מתאימים בקרבתך. נסה/י להגדיל את הרדיוס או לשנות קטגוריה.";
  if (lang === "ar") return "لم أجد أماكن مناسبة قريبة. جرّب زيادة المسافة أو تغيير الفئة.";
  return "No matching places nearby. Try a larger radius or different category.";
}

export function quotaExceededMessage(lang: AiLanguage): string {
  if (lang === "he")
    return `הגעת למכסת ${FREE_DAILY_LIMIT} שאילתות יומיות (FREE).`;
  if (lang === "ar")
    return `وصلت إلى حد ${FREE_DAILY_LIMIT} استفسارات يومية (FREE).`;
  return `Daily limit of ${FREE_DAILY_LIMIT} queries reached (FREE).`;
}

export function getQuickReplies(step: AiStep, lang: AiLanguage): string[] {
  if (step === "mood") {
    return lang === "he"
      ? ["mood:romantic", "mood:fun", "mood:relaxed", "mood:celebrate"]
      : ["mood:romantic", "mood:fun", "mood:relaxed", "mood:celebrate"];
  }
  if (step === "category") {
    return [
      "category:RESTAURANT",
      "category:ROMANTIC_DATE",
      "category:SUSHI",
      "category:SUNSET",
      "category:ATTRACTION",
    ];
  }
  if (step === "budget") {
    return ["budget:FREE", "budget:BUDGET", "budget:MODERATE", "budget:EXPENSIVE"];
  }
  if (step === "radius") {
    return ["radius:2", "radius:5", "radius:10", "radius:20"];
  }
  return [];
}

export function quickReplyLabel(value: string, lang: AiLanguage): string {
  const labels: Record<string, Record<AiLanguage, string>> = {
    "mood:romantic": { he: "💕 רומנטי", en: "💕 Romantic", ar: "💕 رومانسي" },
    "mood:fun": { he: "🎉 כיפי", en: "🎉 Fun", ar: "🎉 مرح" },
    "mood:relaxed": { he: "😌 רגוע", en: "😌 Relaxed", ar: "😌 هادئ" },
    "mood:celebrate": { he: "🥂 לחגוג", en: "🥂 Celebrate", ar: "🥂 احتفال" },
    "category:RESTAURANT": { he: "🍽 מסעדה", en: "🍽 Restaurant", ar: "🍽 مطعم" },
    "category:ROMANTIC_DATE": { he: "💕 דייט", en: "💕 Date", ar: "💕 موعد" },
    "category:SUSHI": { he: "🍣 סושי", en: "🍣 Sushi", ar: "🍣 سوشي" },
    "category:SUNSET": { he: "🌅 שקיעה", en: "🌅 Sunset", ar: "🌅 غروب" },
    "category:ATTRACTION": { he: "🎡 אטרקציה", en: "🎡 Attraction", ar: "🎡 attraction" },
    "budget:FREE": { he: "חינם", en: "Free", ar: "مجاني" },
    "budget:BUDGET": { he: "₪", en: "₪", ar: "₪" },
    "budget:MODERATE": { he: "₪₪", en: "₪₪", ar: "₪₪" },
    "budget:EXPENSIVE": { he: "₪₪₪", en: "₪₪₪", ar: "₪₪₪" },
    "radius:2": { he: "2 ק\"מ", en: "2 km", ar: "2 كم" },
    "radius:5": { he: "5 ק\"מ", en: "5 km", ar: "5 كم" },
    "radius:10": { he: "10 ק\"מ", en: "10 km", ar: "10 كم" },
    "radius:20": { he: "20 ק\"מ", en: "20 km", ar: "20 كم" },
  };
  return labels[value]?.[lang] ?? value;
}
