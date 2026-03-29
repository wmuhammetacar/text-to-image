import { describe, expect, it } from "vitest";
import { SubmitGenerationUseCase } from "@vi/application";
import { MockSafetyShapingProvider } from "@vi/providers";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import { NoopLogger, SequenceIdFactory } from "../helpers/test-doubles";

const USER_ID = "00000000-0000-0000-0000-000000000111";

describe("SubmitGenerationUseCase", () => {
  it("submitGeneration basarili akista generation, run ve debit olusturur", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const useCase = new SubmitGenerationUseCase(
      repository,
      new MockSafetyShapingProvider(),
      new SequenceIdFactory(["70000000-0000-0000-0000-000000000001"]),
      new NoopLogger(),
    );

    const response = await useCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-submit-1",
      payload: {
        text: "Sisli, sakin ve nostaljik bir sokak",
        requested_image_count: 2,
        creative_mode: "balanced",
        controls: {
          calmness: 2,
          nostalgia: 1,
        },
      },
      requestId: "req_submit_000001",
      creditCostPerImage: 1,
    });

    expect(response.generation_id).toBeTruthy();
    expect(response.run_id).toBeTruthy();
    expect(response.active_run_state).toBe("queued");
    expect(response.correlation_id).toBe("70000000-0000-0000-0000-000000000001");

    const generation = repository.getGeneration(response.generation_id);
    expect(generation?.activeRunId).toBe(response.run_id);
    expect(generation?.state).toBe("active");

    const run = repository.getRun(response.run_id);
    expect(run?.pipelineState).toBe("queued");
    expect(run?.runSource).toBe("initial");

    const balance = await repository.getCreditBalance(USER_ID);
    expect(balance?.balance).toBe(8);

    const job = repository.getJobByRun(response.run_id);
    expect(job?.queueState).toBe("queued");
  });

  it("idempotent submit ayni key + ayni body icin ayni sonucu dondurur", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const useCase = new SubmitGenerationUseCase(
      repository,
      new MockSafetyShapingProvider(),
      new SequenceIdFactory([
        "70000000-0000-0000-0000-000000000010",
        "70000000-0000-0000-0000-000000000011",
      ]),
      new NoopLogger(),
    );

    const payload = {
      text: "Gunesin battigi sakin bir vadi",
      requested_image_count: 1,
      creative_mode: "fast" as const,
      controls: {},
    };

    const first = await useCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-submit-2",
      payload,
      requestId: "req_submit_000002",
      creditCostPerImage: 1,
    });

    const second = await useCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-submit-2",
      payload,
      requestId: "req_submit_000003",
      creditCostPerImage: 1,
    });

    expect(second.generation_id).toBe(first.generation_id);
    expect(second.run_id).toBe(first.run_id);

    const runs = repository.getRunsByGeneration(first.generation_id);
    expect(runs).toHaveLength(1);

    const balance = await repository.getCreditBalance(USER_ID);
    expect(balance?.balance).toBe(9);
  });
});
