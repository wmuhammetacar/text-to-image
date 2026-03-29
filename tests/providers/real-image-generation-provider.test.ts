import { describe, expect, it, vi } from "vitest";
import { RetryablePipelineError } from "@vi/application";
import {
  ProviderInvalidResponseError,
  ProviderRateLimitError,
  ProviderSafetyBlockError,
  ProviderTimeoutError,
  RealImageGenerationProvider,
  type ImageAssetStore,
} from "@vi/providers";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function binaryResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(Buffer.from(bytes), {
    status,
    headers: {
      "content-type": "image/png",
    },
  });
}

function createMemoryStore(): {
  store: ImageAssetStore;
  uploads: Array<{ bucket: string; path: string; contentType: string; bytes: Uint8Array }>;
} {
  const uploads: Array<{ bucket: string; path: string; contentType: string; bytes: Uint8Array }> = [];
  return {
    uploads,
    store: {
      async upload(input) {
        uploads.push(input);
      },
    },
  };
}

describe("RealImageGenerationProvider", () => {
  it("b64 response normalize eder ve deterministic storage_path ile yazar", async () => {
    const { store, uploads } = createMemoryStore();
    const sampleBytes = Uint8Array.from([1, 2, 3, 4, 5]);
    const sampleBase64 = Buffer.from(sampleBytes).toString("base64");

    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          { b64_json: sampleBase64 },
          { b64_json: sampleBase64 },
        ],
      }),
    );

    const provider = new RealImageGenerationProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-image-1",
      imageSize: "1024x1024",
      timeoutMs: 1000,
      maxRetries: 0,
      imageStorageBucket: "generated-images",
      imageAssetStore: store,
      fetchFn,
    });

    const result = await provider.generate({
      generationId: "30000000-0000-0000-0000-000000000001",
      runId: "40000000-0000-0000-0000-000000000001",
      correlationId: "corr-1",
      requestedImageCount: 2,
      prompt: "Sisli bir orman",
      creativeMode: "balanced",
    });

    expect(result.variants).toHaveLength(2);
    expect(result.variants[0]?.storagePath).toBe(
      "30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/variant-1.png",
    );
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.bucket).toBe("generated-images");
    expect(JSON.stringify(result.providerRequestRedacted)).not.toContain("Sisli bir orman");
    expect(JSON.stringify(result.providerRequestRedacted)).not.toContain("test-key");
  });

  it("invalid response durumunda hata verir", async () => {
    const { store } = createMemoryStore();
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [],
      }),
    );

    const provider = new RealImageGenerationProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-image-1",
      imageSize: "1024x1024",
      timeoutMs: 1000,
      maxRetries: 0,
      imageStorageBucket: "generated-images",
      imageAssetStore: store,
      fetchFn,
    });

    await expect(
      provider.generate({
        generationId: "30000000-0000-0000-0000-000000000001",
        runId: "40000000-0000-0000-0000-000000000001",
        correlationId: "corr-1",
        requestedImageCount: 1,
        prompt: "test",
        creativeMode: "balanced",
      }),
    ).rejects.toBeInstanceOf(ProviderInvalidResponseError);
  });

  it("url download timeout durumunda retryable timeout üretir", async () => {
    const { store } = createMemoryStore();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () =>
        jsonResponse({
          data: [{ url: "https://assets.example.com/img-1.png" }],
        }),
      )
      .mockImplementationOnce(async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      });

    const provider = new RealImageGenerationProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-image-1",
      imageSize: "1024x1024",
      timeoutMs: 5,
      maxRetries: 0,
      imageStorageBucket: "generated-images",
      imageAssetStore: store,
      fetchFn,
      outputFormat: "url",
    });

    await expect(
      provider.generate({
        generationId: "30000000-0000-0000-0000-000000000001",
        runId: "40000000-0000-0000-0000-000000000001",
        correlationId: "corr-1",
        requestedImageCount: 1,
        prompt: "test",
        creativeMode: "balanced",
      }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("kısmi response durumunda başarılı varyantları döndürür", async () => {
    const { store, uploads } = createMemoryStore();
    const sampleBytes = Uint8Array.from([1, 2, 3]);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () =>
        jsonResponse({
          data: [
            { b64_json: Buffer.from(sampleBytes).toString("base64") },
            { url: "https://assets.example.com/img-2.png" },
          ],
        }),
      )
      .mockImplementationOnce(async () =>
        binaryResponse(Uint8Array.from([9, 9, 9]), 200),
      );

    const provider = new RealImageGenerationProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-image-1",
      imageSize: "1024x1024",
      timeoutMs: 1000,
      maxRetries: 0,
      imageStorageBucket: "generated-images",
      imageAssetStore: store,
      fetchFn,
      outputFormat: "url",
    });

    const result = await provider.generate({
      generationId: "30000000-0000-0000-0000-000000000001",
      runId: "40000000-0000-0000-0000-000000000001",
      correlationId: "corr-1",
      requestedImageCount: 2,
      prompt: "test",
      creativeMode: "balanced",
    });

    expect(result.variants).toHaveLength(2);
    expect(uploads).toHaveLength(2);
  });

  it("429 durumunda retryable rate limit hatası verir", async () => {
    const { store } = createMemoryStore();
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message: "rate limit",
          },
        },
        429,
      ),
    );

    const provider = new RealImageGenerationProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-image-1",
      imageSize: "1024x1024",
      timeoutMs: 1000,
      maxRetries: 0,
      imageStorageBucket: "generated-images",
      imageAssetStore: store,
      fetchFn,
    });

    await expect(
      provider.generate({
        generationId: "30000000-0000-0000-0000-000000000001",
        runId: "40000000-0000-0000-0000-000000000001",
        correlationId: "corr-1",
        requestedImageCount: 1,
        prompt: "test",
        creativeMode: "balanced",
      }),
    ).rejects.toBeInstanceOf(ProviderRateLimitError);

    await expect(
      provider.generate({
        generationId: "30000000-0000-0000-0000-000000000001",
        runId: "40000000-0000-0000-0000-000000000001",
        correlationId: "corr-1",
        requestedImageCount: 1,
        prompt: "test",
        creativeMode: "balanced",
      }),
    ).rejects.toBeInstanceOf(RetryablePipelineError);
  });

  it("safety policy yanitinda safety block hatasi verir", async () => {
    const { store } = createMemoryStore();
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message: "Content policy safety violation",
          },
        },
        422,
      ),
    );

    const provider = new RealImageGenerationProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-image-1",
      imageSize: "1024x1024",
      timeoutMs: 1000,
      maxRetries: 0,
      imageStorageBucket: "generated-images",
      imageAssetStore: store,
      fetchFn,
    });

    await expect(
      provider.generate({
        generationId: "30000000-0000-0000-0000-000000000001",
        runId: "40000000-0000-0000-0000-000000000001",
        correlationId: "corr-1",
        requestedImageCount: 1,
        prompt: "test",
        creativeMode: "balanced",
      }),
    ).rejects.toBeInstanceOf(ProviderSafetyBlockError);
  });
});
