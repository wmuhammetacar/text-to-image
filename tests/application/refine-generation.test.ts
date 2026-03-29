import { describe, expect, it } from "vitest";
import {
  RefineGenerationUseCase,
  SubmitGenerationUseCase,
} from "@vi/application";
import { MockSafetyShapingProvider } from "@vi/providers";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import { NoopLogger, SequenceIdFactory } from "../helpers/test-doubles";

const USER_ID = "00000000-0000-0000-0000-000000000112";

describe("RefineGenerationUseCase", () => {
  it("refine yeni run acar ve eski run'i degistirmez", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 20);

    const logger = new NoopLogger();
    const safetyProvider = new MockSafetyShapingProvider();

    const submitUseCase = new SubmitGenerationUseCase(
      repository,
      safetyProvider,
      new SequenceIdFactory(["70000000-0000-0000-0000-000000000021"]),
      logger,
    );

    const submitted = await submitUseCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-refine-submit-1",
      payload: {
        text: "Yagmur sonrasi filmik bir cadde",
        requested_image_count: 2,
        creative_mode: "balanced",
        controls: {},
      },
      requestId: "req_refine_submit_1",
      creditCostPerImage: 1,
    });

    await repository.withTransaction(async (tx) => {
      await tx.transitionRunState({
        runId: submitted.run_id,
        from: "queued",
        to: "analyzing",
        setStartedAt: true,
      });
      await tx.transitionRunState({
        runId: submitted.run_id,
        from: "analyzing",
        to: "planning",
      });
      await tx.transitionRunState({
        runId: submitted.run_id,
        from: "planning",
        to: "generating",
      });
      await tx.transitionRunState({
        runId: submitted.run_id,
        from: "generating",
        to: "completed",
        setCompletedAt: true,
      });
      await tx.updateGenerationState(submitted.generation_id, "completed");
    });

    const oldRunBeforeRefine = repository.getRun(submitted.run_id);
    expect(oldRunBeforeRefine?.pipelineState).toBe("completed");

    const refineUseCase = new RefineGenerationUseCase(
      repository,
      safetyProvider,
      new SequenceIdFactory(["70000000-0000-0000-0000-000000000022"]),
      logger,
    );

    const refined = await refineUseCase.execute({
      userId: USER_ID,
      generationId: submitted.generation_id,
      idempotencyKey: "idem-refine-1",
      payload: {
        refinement_instruction: "Daha karanlik, daha sinematik yap",
        controls_delta: {
          darkness: 2,
          cinematic: 2,
        },
        requested_image_count: 3,
      },
      requestId: "req_refine_1",
      creditCostPerImage: 1,
    });

    expect(refined.generation_id).toBe(submitted.generation_id);
    expect(refined.new_run_id).not.toBe(submitted.run_id);
    expect(refined.active_run_state).toBe("queued");

    const oldRunAfterRefine = repository.getRun(submitted.run_id);
    expect(oldRunAfterRefine?.pipelineState).toBe("completed");

    const newRun = repository.getRun(refined.new_run_id);
    expect(newRun?.runSource).toBe("refine");
    expect(newRun?.runNumber).toBe(2);
    expect(newRun?.requestedImageCount).toBe(3);

    const generation = repository.getGeneration(submitted.generation_id);
    expect(generation?.activeRunId).toBe(refined.new_run_id);
    expect(generation?.state).toBe("active");
  });
});
