import { describe, expect, it } from "vitest";
import {
  ApplyRunRefundUseCase,
  ProcessGenerationRunUseCase,
  SubmitGenerationUseCase,
  type EmotionAnalysisProvider,
  type ImageGenerationInput,
  type ImageGenerationProvider,
  type SafetyShapingProvider,
} from "@vi/application";
import { MockSafetyShapingProvider } from "@vi/providers";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import { NoopLogger, SequenceIdFactory } from "../helpers/test-doubles";

const USER_ID = "00000000-0000-0000-0000-000000000221";

function createSubmitUseCase(repository: InMemoryRepository): SubmitGenerationUseCase {
  return new SubmitGenerationUseCase(
    repository,
    new MockSafetyShapingProvider(),
    new SequenceIdFactory([
      "91000000-0000-0000-0000-000000000001",
      "91000000-0000-0000-0000-000000000002",
      "91000000-0000-0000-0000-000000000003",
    ]),
    new NoopLogger(),
  );
}

async function createRun(repository: InMemoryRepository): Promise<{ generationId: string; runId: string }> {
  const submitted = await createSubmitUseCase(repository).execute({
    userId: USER_ID,
    idempotencyKey: "idem-creative-integrity-1",
    payload: {
      text: "Yağmurlu bir şehirde dramatik ve sinematik bir gece",
      requested_image_count: 1,
      creative_mode: "directed",
      controls: {
        darkness: 1,
        cinematic: 2,
      },
    },
    requestId: "req_creative_integrity_1",
    creditCostPerImage: 1,
  });

  return {
    generationId: submitted.generation_id,
    runId: submitted.run_id,
  };
}

describe("Creative pipeline integrity", () => {
  it("pipeline creative directions + visual plan + explainability üretir ve provider'a structured input gönderir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);
    const created = await createRun(repository);

    const emotionProvider: EmotionAnalysisProvider = {
      async analyze() {
        return {
          providerName: "test-emotion",
          modelName: "test-model",
          userIntent: {
            confidence: 0.87,
            intentJson: {
              summary: "dramatik gece atmosferi",
              subjects: ["şehir", "yağmur", "sokak ışıkları"],
              visual_goal: "yüksek duygu yoğunluklu kompozisyon",
            },
          },
          emotionAnalysis: {
            analysisJson: {
              dominant_emotion: "tension",
              intensity: 8,
              atmosphere: ["rainy", "noir"],
              themes: ["urban", "isolation"],
            },
          },
          providerRequestRedacted: {},
          providerResponseRedacted: {},
        };
      },
    };

    const safetyProvider: SafetyShapingProvider = {
      async moderateInputText(text) {
        return {
          stage: "input_moderation",
          decision: "allow",
          policyCode: "ALLOW",
          message: null,
          sanitizedText: text,
        };
      },
      async shapeBeforeGeneration(input) {
        return {
          providerName: "test-safety",
          decision: "allow",
          policyCode: "ALLOW",
          message: null,
          shapedText: input.sourceText,
          providerRequestRedacted: {},
          providerResponseRedacted: {},
        };
      },
      async moderateOutput() {
        return {
          decision: "allow",
          policyCode: "ALLOW",
          message: null,
        };
      },
    };

    const capturedInputs: ImageGenerationInput[] = [];
    const imageProvider: ImageGenerationProvider = {
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
              metadata: {},
            },
          ],
          providerRequestRedacted: {},
          providerResponseRedacted: {},
        };
      },
    };

    const process = new ProcessGenerationRunUseCase(
      repository,
      emotionProvider,
      safetyProvider,
      imageProvider,
      new ApplyRunRefundUseCase(repository, new NoopLogger(), 1),
      new NoopLogger(),
    );

    const result = await process.execute({
      runId: created.runId,
      requestId: "req_creative_integrity_process",
    });

    expect(result.terminalState).toBe("completed");
    expect(capturedInputs.length).toBe(4);
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
    const finalInput = capturedInputs[capturedInputs.length - 1] as unknown as ImageGenerationInput;
    expect(finalInput.promptCore).toBeTruthy();
    expect(finalInput.promptExpanded).toBeTruthy();
    expect(finalInput.negativePrompt).toBeTruthy();
    expect(finalInput.styleMetadata?.styleTags.length).toBeGreaterThan(0);
    expect(finalInput.styleMetadata?.creativeType).toBeTruthy();
    expect(finalInput.styleMetadata?.emotionalRenderingStyle).toBeTruthy();
    expect(finalInput.compositionHints?.shotType).toBeTruthy();
    expect(finalInput.compositionHints?.cameraDistance).toBeTruthy();
    expect(finalInput.compositionHints?.sceneDensity).toBeTruthy();
    expect(finalInput.lightingHints?.keyLight).toBeTruthy();
    expect(finalInput.colorHints?.strategy).toBeTruthy();
    expect(finalInput.realismLevel).toBeGreaterThan(0);
    expect(finalInput.stylizationLevel).toBeGreaterThan(0);

    const aggregate = await repository.getGenerationDetailForService(created.generationId);
    expect(aggregate?.creativeDirections.length).toBeGreaterThanOrEqual(3);
    expect(aggregate?.passes.length).toBe(4);
    expect(aggregate?.passes.map((entry) => entry.passType)).toEqual([
      "concept",
      "composition",
      "detail",
      "enhancement",
    ]);
    expect(aggregate?.visualPlan).not.toBeNull();
    expect(aggregate?.visualPlan?.planJson.subjectDefinition.length).toBeGreaterThan(10);
    expect(aggregate?.visualPlan?.planJson.focalHierarchy.length).toBeGreaterThan(0);
    expect(aggregate?.visualPlan?.explainabilityJson.summary.length).toBeGreaterThan(20);
    expect(aggregate?.visualPlan?.explainabilityJson.whySelectedDirection.length).toBeGreaterThan(20);
    expect(aggregate?.visualPlan?.explainabilityJson.qualitySignals.directionCount).toBeGreaterThanOrEqual(3);
    expect(aggregate?.visualPlan?.explainabilityJson.qualitySignals.bestVariantScore).toBeGreaterThan(0);
    expect(aggregate?.visualPlan?.explainabilityJson.qualitySignals.evaluatedVariantCount).toBeGreaterThan(0);
    expect(aggregate?.visualPlan?.explainabilityJson.outputQuality?.bestVariantId).toBeTruthy();
    expect(aggregate?.visualPlan?.explainabilityJson.outputQuality?.variantScores.length).toBeGreaterThan(0);
  });

  it("illegal state transition engellenir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);
    const created = await createRun(repository);

    const run = repository.getRun(created.runId);
    if (run === null) {
      throw new Error("RUN_NOT_FOUND");
    }
    run.pipelineState = "completed";

    const process = new ProcessGenerationRunUseCase(
      repository,
      {
        async analyze() {
          return {
            providerName: "unused",
            modelName: "unused",
            userIntent: { intentJson: {}, confidence: 0.5 },
            emotionAnalysis: { analysisJson: {} },
            providerRequestRedacted: {},
            providerResponseRedacted: {},
          };
        },
      },
      new MockSafetyShapingProvider(),
      {
        async generate() {
          return {
            providerName: "unused",
            requestedImageCount: 1,
            variants: [],
            providerRequestRedacted: {},
            providerResponseRedacted: {},
          };
        },
      },
      new ApplyRunRefundUseCase(repository, new NoopLogger(), 1),
      new NoopLogger(),
    );

    await expect(
      process.execute({
        runId: created.runId,
        requestId: "req_creative_illegal_state",
      }),
    ).rejects.toThrow("ILLEGAL_RUN_TRANSITION");
  });
});
