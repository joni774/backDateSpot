export interface PostFilterResult {
  blocked: boolean;
  reason?: string;
}

const LEAK_KEYWORDS =
  /\b(system\s*prompt|הנחיות|instructions|prompt\s*injection|ignore\s+(all\s+)?previous)\b/i;

const CODE_MARKERS =
  /```|\bfunction\s*\(|\bSELECT\s+.+\bFROM\b|\bDROP\s+TABLE\b|\bprisma\./i;

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/;
const API_KEY_SHAPE =
  /\b(sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,})\b/;

/**
 * Layer 3: scan model output before returning to the user (policy §4.2).
 */
export function postFilterOutput(content: string): PostFilterResult {
  if (!content || !content.trim()) {
    return { blocked: true, reason: "empty_output" };
  }

  if (LEAK_KEYWORDS.test(content)) {
    return { blocked: true, reason: "prompt_leak_keywords" };
  }
  if (CODE_MARKERS.test(content)) {
    return { blocked: true, reason: "code_or_sql" };
  }
  if (EMAIL.test(content)) {
    return { blocked: true, reason: "email_detected" };
  }
  if (API_KEY_SHAPE.test(content)) {
    return { blocked: true, reason: "api_key_shape" };
  }
  // Phone heuristic: only flag long digit runs that look like phone numbers
  const phoneMatch = content.match(PHONE);
  if (phoneMatch && phoneMatch[0].replace(/\D/g, "").length >= 9) {
    return { blocked: true, reason: "phone_detected" };
  }

  return { blocked: false };
}
