/**
 * Opening-hours helpers: Google Place Details → DateSpot day map + open-now checks.
 */
const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type DayKey = (typeof DAY_KEYS)[number];

export type OpeningHoursMap = Record<DayKey, string>;

export type GoogleOpeningPeriod = {
  open?: { day?: number; time?: string };
  close?: { day?: number; time?: string };
};

export type GoogleOpeningHours = {
  open_now?: boolean;
  periods?: GoogleOpeningPeriod[];
  weekday_text?: string[];
};

const CLOSED = "closed";

export function emptyOpeningHours(): OpeningHoursMap {
  return {
    sunday: CLOSED,
    monday: CLOSED,
    tuesday: CLOSED,
    wednesday: CLOSED,
    thursday: CLOSED,
    friday: CLOSED,
    saturday: CLOSED,
  };
}

export function hasUsableOpeningHours(openingHours: unknown): boolean {
  if (!openingHours || typeof openingHours !== "object") return false;
  const hours = openingHours as Record<string, unknown>;
  return DAY_KEYS.some((day) => {
    const value = hours[day];
    return typeof value === "string" && value.trim().length > 0 && value.toLowerCase() !== CLOSED;
  });
}

function formatHhmm(raw: string): string {
  const padded = raw.padStart(4, "0");
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
}

/**
 * Convert Google Places `opening_hours.periods` into our sunday–saturday map.
 */
export function normalizeGoogleOpeningHours(
  openingHours: GoogleOpeningHours | undefined | null
): OpeningHoursMap | null {
  if (!openingHours?.periods?.length) return null;

  const hours = emptyOpeningHours();
  const buckets: Record<DayKey, string[]> = {
    sunday: [],
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
  };

  for (const period of openingHours.periods) {
    const openDay = period.open?.day;
    const openTime = period.open?.time;
    if (openDay == null || openDay < 0 || openDay > 6 || !openTime) continue;
    const day = DAY_KEYS[openDay];

    // Google represents 24/7 as a single open with no close.
    if (!period.close?.time) {
      for (const key of DAY_KEYS) {
        buckets[key] = ["00:00 - 23:59"];
      }
      break;
    }

    const range = `${formatHhmm(openTime)} - ${formatHhmm(period.close.time)}`;
    buckets[day].push(range);
  }

  for (const day of DAY_KEYS) {
    hours[day] = buckets[day].length > 0 ? buckets[day].join(", ") : CLOSED;
  }

  if (!hasUsableOpeningHours(hours)) return null;
  return hours;
}

function parseRanges(todayHours: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const re = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(todayHours)) != null) {
    const start = parseInt(match[1]!, 10) * 60 + parseInt(match[2]!, 10);
    const end = parseInt(match[3]!, 10) * 60 + parseInt(match[4]!, 10);
    ranges.push({ start, end });
  }
  return ranges;
}

function israelNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
}

/**
 * Whether the place is open right now (Asia/Jerusalem).
 * Unknown / empty hours → true so we never falsely show "closed".
 */
export function isPlaceOpenNow(openingHours: unknown): boolean {
  if (!hasUsableOpeningHours(openingHours)) return true;

  const hours = openingHours as Record<string, string>;
  const now = israelNow();
  const dayKey = DAY_KEYS[now.getDay()];
  const todayHours = hours[dayKey];
  if (!todayHours || todayHours.toLowerCase() === CLOSED) return false;

  const lower = todayHours.toLowerCase();
  if (
    lower.includes("24") ||
    lower.includes("open 24") ||
    lower === "00:00 - 23:59" ||
    lower === "00:00-23:59"
  ) {
    return true;
  }

  const ranges = parseRanges(todayHours);
  if (ranges.length === 0) return true;

  const current = now.getHours() * 60 + now.getMinutes();
  return ranges.some(({ start, end }) => {
    if (end < start) {
      // Overnight window, e.g. 22:00 - 02:00
      return current >= start || current <= end;
    }
    return current >= start && current <= end;
  });
}

export { DAY_KEYS };
