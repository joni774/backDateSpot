import OpenAI from "openai";
import type { AiLanguage } from "../recommender";
import { getSystemPrompt } from "../prompts/systemPrompt";
import {
  SEARCH_PLACES_TOOL,
  executeSearchPlaces,
  searchPlacesArgsSchema,
  type FindPlacesFn,
  type SearchPlacesArgs,
} from "./searchPlacesTool";
import type { AiRecommendations } from "../recommender";

export interface OpenAiClientConfig {
  apiKey: string;
  model?: string;
  classifierModel?: string;
}

export interface AgentResult {
  content: string;
  recommendations: AiRecommendations | null;
}

export class OpenAiClient {
  private client: OpenAI;
  private model: string;
  private classifierModel: string;

  constructor(config: OpenAiClientConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? "gpt-4o-mini";
    this.classifierModel = config.classifierModel ?? this.model;
  }

  /** Layer 1 cheap classification — returns raw label text. */
  async classify(prompt: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.classifierModel,
      temperature: 0,
      max_tokens: 16,
      messages: [{ role: "user", content: prompt }],
    });
    return (res.choices[0]?.message?.content ?? "").trim().toUpperCase();
  }

  /**
   * Layer 2 main agent with search_places tool only.
   * At most one tool round-trip then a final natural-language reply.
   */
  async runAgent(params: {
    language: AiLanguage;
    userMessage: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    findMany: FindPlacesFn;
    lat?: number;
    lng?: number;
  }): Promise<AgentResult> {
    const system = getSystemPrompt(params.language);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      ...(params.history ?? []).slice(-8).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: params.userMessage },
    ];

    let recommendations: AiRecommendations | null = null;

    const first = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.6,
      max_tokens: 600,
      tools: [SEARCH_PLACES_TOOL],
      tool_choice: "auto",
      messages,
    });

    const msg = first.choices[0]?.message;
    if (!msg) {
      return { content: "", recommendations: null };
    }

    if (msg.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
      });

      for (const call of msg.tool_calls) {
        if (call.type !== "function" || call.function.name !== "search_places") {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "unknown_tool" }),
          });
          continue;
        }
        let args: SearchPlacesArgs = {};
        try {
          args = searchPlacesArgsSchema.parse(
            JSON.parse(call.function.arguments || "{}")
          );
        } catch {
          args = {};
        }
        const result = await executeSearchPlaces(
          params.findMany,
          args,
          params.language,
          { lat: params.lat, lng: params.lng }
        );
        if (result.recommendations) {
          recommendations = result.recommendations;
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.summary,
        });
      }

      const second = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.6,
        max_tokens: 600,
        messages,
      });
      const content = second.choices[0]?.message?.content?.trim() ?? "";
      return { content, recommendations };
    }

    return {
      content: (msg.content ?? "").trim(),
      recommendations,
    };
  }
}

export function createOpenAiClient(
  config: OpenAiClientConfig | null | undefined
): OpenAiClient | null {
  if (!config?.apiKey?.trim()) return null;
  return new OpenAiClient(config);
}
