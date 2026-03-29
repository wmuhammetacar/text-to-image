import { describe, expect, it, vi } from "vitest";
import { RetryablePipelineError } from "@vi/application";
import {
  ProviderInvalidResponseError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  RealEmotionAnalysisProvider,
} from "@vi/providers";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("RealEmotionAnalysisProvider", () => {
  it("response normalize eder ve redaction uygular", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        output_text: JSON.stringify({
          user_intent: {
            summary: "Sakin bir akşam sahnesi",
            subjects: ["şehir", "yağmur"],
            visual_goal: "nostaljik bir kompozisyon",
            confidence: 0.88,
          },
          emotion_analysis: {
            dominant_emotion: "nostalgia",
            intensity: 7,
            atmosphere: ["misty", "cinematic"],
            themes: ["memory"],
          },
        }),
      }),
    );

    const provider = new RealEmotionAnalysisProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4.1-mini",
      timeoutMs: 1000,
      maxRetries: 0,
      fetchFn,
    });

    const result = await provider.analyze({
      generationId: "10000000-0000-0000-0000-000000000001",
      runId: "20000000-0000-0000-0000-000000000001",
      text: "Nostaljik bir şehir gecesi üret",
    });

    expect(result.userIntent.confidence).toBe(0.88);
    expect(result.emotionAnalysis.analysisJson.dominant_emotion).toBe("nostalgia");
    expect(result.providerRequestRedacted.text_length).toBeGreaterThan(0);
    expect(JSON.stringify(result.providerRequestRedacted)).not.toContain("Nostaljik bir şehir");
    expect(JSON.stringify(result.providerRequestRedacted)).not.toContain("test-key");
  });

  it("invalid provider response durumunda hata verir", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        output_text: "json degil",
      }),
    );

    const provider = new RealEmotionAnalysisProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4.1-mini",
      timeoutMs: 1000,
      maxRetries: 0,
      fetchFn,
    });

    await expect(
      provider.analyze({
        generationId: "10000000-0000-0000-0000-000000000001",
        runId: "20000000-0000-0000-0000-000000000001",
        text: "test",
      }),
    ).rejects.toBeInstanceOf(ProviderInvalidResponseError);
  });

  it("timeout durumunu retryable timeout hatasına çevirir", async () => {
    const fetchFn = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    const provider = new RealEmotionAnalysisProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4.1-mini",
      timeoutMs: 5,
      maxRetries: 0,
      fetchFn,
    });

    await expect(
      provider.analyze({
        generationId: "10000000-0000-0000-0000-000000000001",
        runId: "20000000-0000-0000-0000-000000000001",
        text: "test",
      }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("429 durumunda rate limit retryable hatası verir", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message: "Rate limit exceeded",
          },
        },
        429,
      ),
    );

    const provider = new RealEmotionAnalysisProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4.1-mini",
      timeoutMs: 1000,
      maxRetries: 0,
      fetchFn,
    });

    await expect(
      provider.analyze({
        generationId: "10000000-0000-0000-0000-000000000001",
        runId: "20000000-0000-0000-0000-000000000001",
        text: "test",
      }),
    ).rejects.toBeInstanceOf(ProviderRateLimitError);

    await expect(
      provider.analyze({
        generationId: "10000000-0000-0000-0000-000000000001",
        runId: "20000000-0000-0000-0000-000000000001",
        text: "test",
      }),
    ).rejects.toBeInstanceOf(RetryablePipelineError);
  });
});
