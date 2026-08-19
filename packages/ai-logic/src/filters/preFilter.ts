import {
  parseBudget,
  parseCategory,
  parseMood,
  parsePartySize,
  parseQuickMode,
  parseRadius,
} from "../recommender";
import { buildClassifierPrompt } from "../prompts/classifierPrompt";
import type { OpenAiClient } from "../llm/openaiClient";

export type Relevance = "RELEVANT" | "NOT_RELEVANT";

/** Fast keyword allowlist — zero LLM cost when clearly on-topic. */
export function keywordAllowlistHit(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;

  // Structured commands from the UI
  if (
    /^(start|התחל|ابدأ|inicio)$/i.test(trimmed) ||
    trimmed.toLowerCase().startsWith("mode:") ||
    trimmed.toLowerCase().startsWith("mood:") ||
    trimmed.toLowerCase().startsWith("category:") ||
    trimmed.toLowerCase().startsWith("budget:") ||
    trimmed.toLowerCase().startsWith("radius:") ||
    trimmed.toLowerCase().startsWith("party:")
  ) {
    return true;
  }

  return Boolean(
    parseQuickMode(trimmed) ||
      parseMood(trimmed) ||
      parseCategory(trimmed) ||
      parseBudget(trimmed) ||
      parseRadius(trimmed) ||
      parsePartySize(trimmed)
  );
}

/**
 * Layer 1: keyword allowlist first, then cheap classifier for ambiguous input.
 * Without an API client, ambiguous messages are treated as NOT_RELEVANT (fail closed).
 */
export async function classifyRelevance(
  message: string,
  openai: OpenAiClient | null
): Promise<Relevance> {
  if (keywordAllowlistHit(message)) return "RELEVANT";

  if (!openai) return "NOT_RELEVANT";

  const label = await openai.classify(buildClassifierPrompt(message));
  if (label.includes("RELEVANT") && !label.includes("NOT_RELEVANT")) {
    return "RELEVANT";
  }
  if (label.includes("NOT_RELEVANT")) return "NOT_RELEVANT";
  // Unknown classifier output → fail closed
  return "NOT_RELEVANT";
}
