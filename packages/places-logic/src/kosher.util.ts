/** Kosher status derived from place names (Google/OSM) and OSM diet:kosher tags. */

export type KosherStatus = "UNKNOWN" | "NONE" | "PARTIAL" | "STRICT";

export interface KosherDetection {
  status: KosherStatus;
  certification: string | null;
}

const CERT_PATTERNS: { re: RegExp; status: KosherStatus; label: string }[] = [
  { re: /בד[״"']?ץ|badatz/i, status: "STRICT", label: 'בד"ץ' },
  { re: /כשר\s*למהדרין|strictly\s*kosher|strict\s*kosher/i, status: "STRICT", label: "כשר למהדרין" },
  { re: /מהדרין|mehadrin|mehuderet/i, status: "STRICT", label: "מהדרין" },
  { re: /רבנות|rabbinate|rabbanut/i, status: "STRICT", label: "רבנות" },
  { re: /חב[״"']?ד|chabad/i, status: "STRICT", label: 'חב"ד' },
  { re: /under\s*supervision|hashgacha/i, status: "STRICT", label: "כשר" },
  { re: /some\s*kosher|חלקית|partially\s*kosher/i, status: "PARTIAL", label: "כשר חלקית" },
  { re: /\bkosher\b|\bכשר\b|\bכשרה\b/i, status: "STRICT", label: "כשר" },
];

const NON_KOSHER_RE =
  /לא\s*כשר|not\s*kosher|non[\s-]*kosher|treif|tref|טרף|treife/i;

/** Parse OSM `diet:kosher` tag (yes | only | no). */
export function detectKosherFromOsmTag(value: string | undefined): KosherDetection | null {
  const v = value?.trim().toLowerCase();
  if (!v) return null;
  if (v === "no" || v === "false") {
    return { status: "NONE", certification: null };
  }
  if (v === "only") {
    return { status: "STRICT", certification: "כשר בלבד" };
  }
  if (v === "yes" || v === "true") {
    return { status: "STRICT", certification: "כשר" };
  }
  return null;
}

/** Infer kosher status from business name / description text (common on Google listings in Israel). */
export function detectKosherFromText(...parts: (string | null | undefined)[]): KosherDetection {
  const text = parts.filter(Boolean).join(" ").trim();
  if (!text) return { status: "UNKNOWN", certification: null };

  if (NON_KOSHER_RE.test(text)) {
    return { status: "NONE", certification: null };
  }

  for (const { re, status, label } of CERT_PATTERNS) {
    if (re.test(text)) {
      return { status, certification: label };
    }
  }

  return { status: "UNKNOWN", certification: null };
}

/** Merge detections — prefer STRICT over PARTIAL over NONE; keep best certification label. */
export function mergeKosherDetections(
  ...detections: (KosherDetection | null | undefined)[]
): KosherDetection {
  const valid = detections.filter((d): d is KosherDetection => d != null && d.status !== "UNKNOWN");
  if (valid.length === 0) return { status: "UNKNOWN", certification: null };

  const rank: Record<KosherStatus, number> = {
    UNKNOWN: 0,
    NONE: 1,
    PARTIAL: 2,
    STRICT: 3,
  };

  valid.sort((a, b) => rank[b.status] - rank[a.status]);
  const best = valid[0];
  const certification =
    valid.find((d) => d.status === best.status && d.certification)?.certification ??
    best.certification;
  return { status: best.status, certification };
}

export function isFoodPlace(category: string): boolean {
  return (
    category === "RESTAURANT" ||
    category === "DAIRY_RESTAURANT" ||
    category === "MEAT_RESTAURANT" ||
    category === "SUSHI"
  );
}
