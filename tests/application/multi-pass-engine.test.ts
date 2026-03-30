import { describe, expect, it } from "vitest";
import {
  buildCreativeIntelligence,
  MultiPassGenerationEngine,
  RetryablePipelineError,
  type ImageGenerationInput,
  type ImageGenerationProvider,
} from "@vi/application";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import { NoopLogger } from "../helpers/test-doubles";

function buildCreativeFixture() {
  const creative = buildCreativeIntelligence({
    sourceText: "Yağmurlu bir metropolde gece sahnesi",
    refinementInstruction: null,
    creativeMode: "balanced",
    generationControls: {
      cinematic: 2,
      darkness: 1,
    },
    refinementControls: null,
    providerIntentJson: {
      summary: "dramatik şehir gecesi",
      subjects: ["şehir", "yağmur", "ışıklar"],
      visual_goal: "sinematik gerilim",
      narrative_intent: "gerilimli atmosfer",
      style_hints: ["cinematic", "noir"],
      forbidden_elements: [],
    },
    providerEmotionJson: {
      dominant_emotion: "tension",
      secondary_emotions: ["awe"],
      intensity: 8,
      valence: -0.2,
      arousal: 0.82,
      atmosphere: ["rainy", "noir"],
      themes: ["urban"],
      emotional_tone: "charged",
    },
  });

  return {
    visualPlan: creative.visualPlan,
    selectedDirection: creative.creativeDirections.find(
      (entry) => entry.directionIndex === creative.selectedDirectionIndex,
    ) ?? creative.creativeDirections[0]!,
  };
}

describe("Multi-pass generation engine", () => {
  it("full mode pass sırasını korur, promptları ayrıştırır ve artifact chaining uygular", async () => {
    const repository = new InMemoryRepository();
    const logger = new NoopLogger();
    const capturedInputs: ImageGenerationInput[] = [];

    const provider: ImageGenerationProvider = {
      async generate(input) {
        capturedInputs.push(input);
        const passType = input.passContext?.passType ?? "unknown";
        return {
          providerName: "test-image",
          requestedImageCount: input.requestedImageCount,
          variants: [
            {
              variantIndex: 1,
              directionIndex: 1,
              storageBucket: "generated-images",
              storagePath: `${input.generationId}/${input.runId}/${passType}/variant-1.png`,
              mimeType: "image/png",
              width: 1024,
              height: 1024,
              metadata: { pass_type: passType },
            },
          ],
          providerRequestRedacted: {},
          providerResponseRedacted: {},
        };
      },
    };

    const engine = new MultiPassGenerationEngine(
      repository,
      provider,
      logger,
      { fastModePassCount: 2, fullModePassCount: 4 },
    );

    const creative = buildCreativeFixture();
    const result = await engine.execute({
      generationId: "c2785f59-1f6d-4fd6-bcca-3ba97d6ec001",
      runId: "4ab4f95f-933d-4f57-a312-8a5ddff9c001",
      userId: "9e2f3907-1a58-4674-b6c2-5d10c8e5c001",
      correlationId: "89b26b9e-95f9-49d5-b2cb-9e8efcdc1001",
      requestedImageCount: 1,
      creativeMode: "balanced",
      safetyShapedPrompt: creative.visualPlan.promptExpanded,
      visualPlan: creative.visualPlan,
      selectedDirection: {
        directionIndex: creative.selectedDirection.directionIndex,
        spec: creative.selectedDirection.spec,
      },
      variationIntent: null,
      requestId: "req_multi_pass_full_1",
    });

    expect(result.passTypes).toEqual([
      "concept",
      "composition",
      "detail",
      "enhancement",
    ]);
    expect(capturedInputs.map((entry) => entry.passContext?.passType)).toEqual([
      "concept",
      "composition",
      "detail",
      "enhancement",
    ]);
    expect(new Set(capturedInputs.map((entry) => entry.promptExpanded)).size).toBe(4);
    expect(capturedInputs[1]?.passContext?.inputArtifactPaths[0]).toContain("/concept/");
    expect(capturedInputs[2]?.passContext?.inputArtifactPaths[0]).toContain("/composition/");
    expect(capturedInputs[3]?.passContext?.inputArtifactPaths[0]).toContain("/detail/");
    expect(result.finalVariants[0]?.storagePath).toContain("/enhancement/");

    const passes = repository.getPassesByRun("4ab4f95f-933d-4f57-a312-8a5ddff9c001");
    expect(passes.map((entry) => entry.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
  });

  it("fast mode iki pass ile concept + enhancement uygular", async () => {
    const repository = new InMemoryRepository();
    const logger = new NoopLogger();
    const passTypes: Array<string | undefined> = [];

    const provider: ImageGenerationProvider = {
      async generate(input) {
        passTypes.push(input.passContext?.passType);
        const passType = input.passContext?.passType ?? "unknown";
        return {
          providerName: "test-image",
          requestedImageCount: input.requestedImageCount,
          variants: [
            {
              variantIndex: 1,
              directionIndex: 1,
              storageBucket: "generated-images",
              storagePath: `${input.generationId}/${input.runId}/${passType}/variant-1.png`,
              mimeType: "image/png",
              width: 1024,
              height: 1024,
              metadata: { pass_type: passType },
            },
          ],
          providerRequestRedacted: {},
          providerResponseRedacted: {},
        };
      },
    };

    const engine = new MultiPassGenerationEngine(
      repository,
      provider,
      logger,
      { fastModePassCount: 2, fullModePassCount: 4 },
    );
    const creative = buildCreativeFixture();

    await engine.execute({
      generationId: "9b68dd56-1cd4-4d30-88df-a7f079fd0001",
      runId: "7a4b4e11-17f6-415f-b80a-87480f320001",
      userId: "9e2f3907-1a58-4674-b6c2-5d10c8e5c001",
      correlationId: "89b26b9e-95f9-49d5-b2cb-9e8efcdc1002",
      requestedImageCount: 1,
      creativeMode: "fast",
      safetyShapedPrompt: creative.visualPlan.promptExpanded,
      visualPlan: creative.visualPlan,
      selectedDirection: {
        directionIndex: creative.selectedDirection.directionIndex,
        spec: creative.selectedDirection.spec,
      },
      variationIntent: null,
      requestId: "req_multi_pass_fast_1",
    });

    expect(passTypes).toEqual(["concept", "enhancement"]);
  });

  it("ara pass non-retryable fail olursa fallback ile devam eder", async () => {
    const repository = new InMemoryRepository();
    const logger = new NoopLogger();

    const provider: ImageGenerationProvider = {
      async generate(input) {
        const passType = input.passContext?.passType ?? "unknown";
        if (passType === "composition") {
          throw new Error("composition_fail");
        }
        return {
          providerName: "test-image",
          requestedImageCount: input.requestedImageCount,
          variants: [
            {
              variantIndex: 1,
              directionIndex: 1,
              storageBucket: "generated-images",
              storagePath: `${input.generationId}/${input.runId}/${passType}/variant-1.png`,
              mimeType: "image/png",
              width: 1024,
              height: 1024,
              metadata: { pass_type: passType },
            },
          ],
          providerRequestRedacted: {},
          providerResponseRedacted: {},
        };
      },
    };

    const engine = new MultiPassGenerationEngine(
      repository,
      provider,
      logger,
      { fastModePassCount: 2, fullModePassCount: 4 },
    );
    const creative = buildCreativeFixture();

    const result = await engine.execute({
      generationId: "3bb5c8fb-e85c-4dcf-b0e8-b8da56d10001",
      runId: "c67fd5d6-2f02-4f14-b422-f8f1b95f0001",
      userId: "9e2f3907-1a58-4674-b6c2-5d10c8e5c001",
      correlationId: "89b26b9e-95f9-49d5-b2cb-9e8efcdc1003",
      requestedImageCount: 1,
      creativeMode: "balanced",
      safetyShapedPrompt: creative.visualPlan.promptExpanded,
      visualPlan: creative.visualPlan,
      selectedDirection: {
        directionIndex: creative.selectedDirection.directionIndex,
        spec: creative.selectedDirection.spec,
      },
      variationIntent: null,
      requestId: "req_multi_pass_fallback_1",
    });

    expect(result.failedPasses).toEqual(["composition"]);
    expect(result.finalVariants[0]?.storagePath).toContain("/enhancement/");

    const passes = repository.getPassesByRun("c67fd5d6-2f02-4f14-b422-f8f1b95f0001");
    expect(passes.find((entry) => entry.passType === "composition")?.status).toBe("failed");
    expect(passes.find((entry) => entry.passType === "detail")?.status).toBe("completed");
    expect(passes.find((entry) => entry.passType === "enhancement")?.status).toBe("completed");
  });

  it("retryable pass hatasında pipeline hatayı yukarı taşır", async () => {
    const repository = new InMemoryRepository();
    const logger = new NoopLogger();

    const provider: ImageGenerationProvider = {
      async generate(input) {
        const passType = input.passContext?.passType ?? "unknown";
        if (passType === "detail") {
          throw new RetryablePipelineError("detail_retry", "DETAIL_RETRY");
        }
        return {
          providerName: "test-image",
          requestedImageCount: input.requestedImageCount,
          variants: [
            {
              variantIndex: 1,
              directionIndex: 1,
              storageBucket: "generated-images",
              storagePath: `${input.generationId}/${input.runId}/${passType}/variant-1.png`,
              mimeType: "image/png",
              width: 1024,
              height: 1024,
              metadata: { pass_type: passType },
            },
          ],
          providerRequestRedacted: {},
          providerResponseRedacted: {},
        };
      },
    };

    const engine = new MultiPassGenerationEngine(
      repository,
      provider,
      logger,
      { fastModePassCount: 2, fullModePassCount: 4 },
    );
    const creative = buildCreativeFixture();

    await expect(
      engine.execute({
        generationId: "0351fce5-3f9f-4faa-a0d5-a880ba030001",
        runId: "db6a60c0-967d-4982-ad35-77b1ce250001",
        userId: "9e2f3907-1a58-4674-b6c2-5d10c8e5c001",
        correlationId: "89b26b9e-95f9-49d5-b2cb-9e8efcdc1004",
        requestedImageCount: 1,
        creativeMode: "balanced",
        safetyShapedPrompt: creative.visualPlan.promptExpanded,
        visualPlan: creative.visualPlan,
        selectedDirection: {
          directionIndex: creative.selectedDirection.directionIndex,
          spec: creative.selectedDirection.spec,
        },
        variationIntent: null,
        requestId: "req_multi_pass_retryable_1",
      }),
    ).rejects.toThrow("detail_retry");

    const passes = repository.getPassesByRun("db6a60c0-967d-4982-ad35-77b1ce250001");
    expect(passes.find((entry) => entry.passType === "concept")?.status).toBe("completed");
    expect(passes.find((entry) => entry.passType === "composition")?.status).toBe("completed");
    expect(passes.find((entry) => entry.passType === "detail")?.status).toBe("failed");
    expect(passes.find((entry) => entry.passType === "enhancement")).toBeUndefined();
  });
});
