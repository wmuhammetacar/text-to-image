import {
  describe,
  expect,
  it,
} from "vitest";
import { SubmitGenerationUseCase } from "@vi/application";
import { MockSafetyShapingProvider } from "@vi/providers";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import {
  NoopLogger,
  SequenceIdFactory,
} from "../helpers/test-doubles";

const USER_A = "00000000-0000-0000-0000-000000000411";
const USER_B = "00000000-0000-0000-0000-000000000412";

describe("Repository security boundaries", () => {
  it("user-scoped query yalniz kendi kayitlarini getirir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_A, 20);
    repository.seedUser(USER_B, 20);

    const submitUseCase = new SubmitGenerationUseCase(
      repository,
      new MockSafetyShapingProvider(),
      new SequenceIdFactory([
        "74000000-0000-4000-8000-000000000001",
        "74000000-0000-4000-8000-000000000002",
      ]),
      new NoopLogger(),
    );

    const generationA = await submitUseCase.execute({
      userId: USER_A,
      idempotencyKey: "idem-repo-user-a-1",
      payload: {
        text: "Kullanici A generation",
        requested_image_count: 1,
        creative_mode: "balanced",
        controls: {},
      },
      requestId: "req_repo_user_a",
      creditCostPerImage: 1,
    });

    const generationB = await submitUseCase.execute({
      userId: USER_B,
      idempotencyKey: "idem-repo-user-b-1",
      payload: {
        text: "Kullanici B generation",
        requested_image_count: 1,
        creative_mode: "balanced",
        controls: {},
      },
      requestId: "req_repo_user_b",
      creditCostPerImage: 1,
    });

    const pageA = await repository.listGenerationHistoryForUser({
      userId: USER_A,
      limit: 20,
      cursor: null,
    });

    expect(pageA.items.map((item) => item.generationId)).toContain(
      generationA.generation_id,
    );
    expect(pageA.items.map((item) => item.generationId)).not.toContain(
      generationB.generation_id,
    );

    const foreignDetail = await repository.getGenerationDetailForUser(
      generationB.generation_id,
      USER_A,
    );
    expect(foreignDetail).toBeNull();
  });

  it("service-role detail sorgusu background akis icin calisir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_A, 20);

    const submitUseCase = new SubmitGenerationUseCase(
      repository,
      new MockSafetyShapingProvider(),
      new SequenceIdFactory(["74000000-0000-4000-8000-000000000010"]),
      new NoopLogger(),
    );

    const generation = await submitUseCase.execute({
      userId: USER_A,
      idempotencyKey: "idem-repo-service-1",
      payload: {
        text: "Service detail",
        requested_image_count: 1,
        creative_mode: "balanced",
        controls: {},
      },
      requestId: "req_repo_service",
      creditCostPerImage: 1,
    });

    const aggregate = await repository.getGenerationDetailForService(
      generation.generation_id,
    );

    expect(aggregate).not.toBeNull();
    expect(aggregate?.generation.id).toBe(generation.generation_id);
  });

  it("worker service path user context gerektirmez", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_A, 20);

    const submitUseCase = new SubmitGenerationUseCase(
      repository,
      new MockSafetyShapingProvider(),
      new SequenceIdFactory(["74000000-0000-4000-8000-000000000020"]),
      new NoopLogger(),
    );

    const generation = await submitUseCase.execute({
      userId: USER_A,
      idempotencyKey: "idem-repo-worker-path-1",
      payload: {
        text: "Worker context",
        requested_image_count: 1,
        creative_mode: "balanced",
        controls: {},
      },
      requestId: "req_repo_worker",
      creditCostPerImage: 1,
    });

    const context = await repository.getRunExecutionContext(generation.run_id);
    expect(context).not.toBeNull();
    expect(context?.run.id).toBe(generation.run_id);
  });
});
