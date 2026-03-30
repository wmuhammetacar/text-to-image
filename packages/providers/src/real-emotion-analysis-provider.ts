import { z } from "zod";
import type {
  EmotionAnalysisInput,
  EmotionAnalysisProvider,
  EmotionAnalysisResult,
} from "@vi/application";
import { deterministicHash } from "./deterministic";
import { ProviderInvalidResponseError } from "./errors";
import { OpenAiHttpClient } from "./openai-http";

const normalizedEmotionSchema = z.object({
  user_intent: z.object({
    summary: z.string().min(1),
    subjects: z.array(z.string()).default([]),
    visual_goal: z.string().min(1),
    narrative_intent: z.string().optional(),
    style_hints: z.array(z.string()).optional(),
    forbidden_elements: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1),
  }),
  emotion_analysis: z.object({
    dominant_emotion: z.string().min(1),
    intensity: z.number().min(1).max(10),
    secondary_emotions: z.array(z.string()).optional(),
    valence: z.number().min(-1).max(1).optional(),
    arousal: z.number().min(0).max(1).optional(),
    emotional_tone: z.string().optional(),
    atmosphere: z.array(z.string()).min(1),
    themes: z.array(z.string()).default([]),
  }),
});

export interface RealEmotionAnalysisProviderOptions {
  providerName?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  fetchFn?: typeof fetch;
}

function extractTextFromOpenAiPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const root = payload as Record<string, unknown>;
  if (typeof root.output_text === "string" && root.output_text.length > 0) {
    return root.output_text;
  }

  const output = root.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const itemRecord = item as Record<string, unknown>;
      const content = itemRecord.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (typeof part !== "object" || part === null) {
          continue;
        }
        const partRecord = part as Record<string, unknown>;
        if (typeof partRecord.text === "string" && partRecord.text.length > 0) {
          return partRecord.text;
        }
      }
    }
  }

  const choices = root.choices;
  if (Array.isArray(choices)) {
    const first = choices[0];
    if (typeof first === "object" && first !== null) {
      const message = (first as Record<string, unknown>).message;
      if (typeof message === "object" && message !== null) {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === "string" && content.length > 0) {
          return content;
        }
      }
    }
  }

  return null;
}

function parseStructuredJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const noFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(noFence) as Record<string, unknown>;
  } catch {
    throw new ProviderInvalidResponseError(
      "openai-text-analysis",
      "Text analysis provider geçerli JSON döndürmedi.",
    );
  }
}

export class RealEmotionAnalysisProvider implements EmotionAnalysisProvider {
  private readonly providerName: string;
  private readonly model: string;
  private readonly httpClient: OpenAiHttpClient;

  public constructor(options: RealEmotionAnalysisProviderOptions) {
    this.providerName = options.providerName ?? "openai-text-analysis";
    this.model = options.model;
    this.httpClient = new OpenAiHttpClient({
      providerName: this.providerName,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      fetchFn: options.fetchFn,
    });
  }

  public async analyze(input: EmotionAnalysisInput): Promise<EmotionAnalysisResult> {
    const systemInstruction = [
      "You are an emotion and intent parser for visual generation.",
      "Return strict JSON only.",
      "Do not include markdown.",
      "Schema:",
      "{",
      '  "user_intent": {',
      '    "summary": "string",',
      '    "subjects": ["string"],',
      '    "visual_goal": "string",',
      '    "narrative_intent": "string",',
      '    "style_hints": ["string"],',
      '    "forbidden_elements": ["string"],',
      '    "confidence": number 0..1',
      "  },",
      '  "emotion_analysis": {',
      '    "dominant_emotion": "string",',
      '    "intensity": number 1..10,',
      '    "secondary_emotions": ["string"],',
      '    "valence": number -1..1,',
      '    "arousal": number 0..1,',
      '    "emotional_tone": "string",',
      '    "atmosphere": ["string"],',
      '    "themes": ["string"]',
      "  }",
      "}",
    ].join("\n");

    const responsePayload = await this.httpClient.postJson("/responses", {
      model: this.model,
      input: [
        {
          role: "system",
          content: systemInstruction,
        },
        {
          role: "user",
          content: input.text,
        },
      ],
      temperature: 0.2,
      max_output_tokens: 700,
    });

    const outputText = extractTextFromOpenAiPayload(responsePayload);
    if (outputText === null) {
      throw new ProviderInvalidResponseError(
        this.providerName,
        "Text analysis provider çıktısı okunamadı.",
      );
    }

    const rawJson = parseStructuredJson(outputText);
    const parsed = normalizedEmotionSchema.safeParse(rawJson);
    if (!parsed.success) {
      throw new ProviderInvalidResponseError(
        this.providerName,
        `Text analysis şeması geçersiz: ${parsed.error.message}`,
      );
    }

    return {
      providerName: this.providerName,
      modelName: this.model,
      userIntent: {
        intentJson: {
          summary: parsed.data.user_intent.summary,
          subjects: parsed.data.user_intent.subjects,
          visual_goal: parsed.data.user_intent.visual_goal,
          narrative_intent: parsed.data.user_intent.narrative_intent ?? "translate user text into visual story",
          style_hints: parsed.data.user_intent.style_hints ?? [],
          forbidden_elements: parsed.data.user_intent.forbidden_elements ?? [],
        },
        confidence: parsed.data.user_intent.confidence,
      },
      emotionAnalysis: {
        analysisJson: {
          dominant_emotion: parsed.data.emotion_analysis.dominant_emotion,
          secondary_emotions: parsed.data.emotion_analysis.secondary_emotions ?? [],
          intensity: parsed.data.emotion_analysis.intensity,
          valence: parsed.data.emotion_analysis.valence ?? 0,
          arousal: parsed.data.emotion_analysis.arousal ?? 0.5,
          emotional_tone:
            parsed.data.emotion_analysis.emotional_tone ?? parsed.data.emotion_analysis.dominant_emotion,
          atmosphere: parsed.data.emotion_analysis.atmosphere,
          themes: parsed.data.emotion_analysis.themes,
        },
      },
      providerRequestRedacted: {
        endpoint: "/responses",
        model: this.model,
        text_hash: deterministicHash(input.text),
        text_length: input.text.length,
      },
      providerResponseRedacted: {
        dominant_emotion: parsed.data.emotion_analysis.dominant_emotion,
        intensity: parsed.data.emotion_analysis.intensity,
        atmosphere_count: parsed.data.emotion_analysis.atmosphere.length,
      },
    };
  }
}
