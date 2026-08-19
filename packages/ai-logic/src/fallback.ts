/** Fixed fallback when Layer 1 or Layer 3 blocks (policy §5). */
import type { AiLanguage } from "./recommender";

export const FALLBACK_RESPONSE_HE =
  "אני כאן כדי לעזור לך למצוא את המקום המושלם ליציאה 😊\nאיזה סוג בילוי מתאים לך היום?";

export const FALLBACK_RESPONSE_EN =
  "I'm here to help you find the perfect spot to go out 😊\nWhat kind of outing are you in the mood for today?";

export const FALLBACK_RESPONSE_AR =
  "أنا هنا لمساعدتك في إيجاد المكان المثالي للخروج 😊\nأي نوع خروج يناسبك اليوم؟";

export function fallbackResponse(lang: AiLanguage): string {
  if (lang === "en") return FALLBACK_RESPONSE_EN;
  if (lang === "ar") return FALLBACK_RESPONSE_AR;
  return FALLBACK_RESPONSE_HE;
}
