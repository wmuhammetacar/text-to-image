import { afterEach, describe, expect, it, vi } from "vitest";
import { SequenceRequestIdFactory, NoopLogger } from "../helpers/test-doubles";

interface OpsDeps {
  repository: {
    getQueueOperationalStats: (input: { now: Date; staleSeconds: number }) => Promise<{
      queuedCount: number;
      retryWaitCount: number;
      leasedCount: number;
      runningCount: number;
      deadLetterCount: number;
      failedCount: number;
      oldestQueuedAt: Date | null;
      staleLeasedCount: number;
      staleRunningCount: number;
    }>;
  };
  requestIdFactory: SequenceRequestIdFactory;
  logger: NoopLogger;
  config: {
    OPS_API_KEY: string;
    OPS_STALE_JOB_SECONDS: number;
  };
}

function createDeps(stats: Awaited<ReturnType<OpsDeps["repository"]["getQueueOperationalStats"]>>): OpsDeps {
  return {
    repository: {
      getQueueOperationalStats: async () => stats,
    },
    requestIdFactory: new SequenceRequestIdFactory([
      "req_health_0001",
      "req_health_0002",
      "req_health_0003",
      "req_health_0004",
    ]),
    logger: new NoopLogger(),
    config: {
      OPS_API_KEY: "ops_key_for_tests_12345",
      OPS_STALE_JOB_SECONDS: 300,
    },
  };
}

async function loadHealthRoute(deps: OpsDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/health/route");
}

async function loadOpsQueueRoute(deps: OpsDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/ops/queue/route");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Health ve operasyon endpointleri", () => {
  it("health endpoint kuyruk bosken ok doner", async () => {
    const route = await loadHealthRoute(
      createDeps({
        queuedCount: 0,
        retryWaitCount: 0,
        leasedCount: 0,
        runningCount: 0,
        deadLetterCount: 0,
        failedCount: 0,
        oldestQueuedAt: null,
        staleLeasedCount: 0,
        staleRunningCount: 0,
      }),
    );

    const response = await route.GET();
    const body = (await response.json()) as {
      status: string;
      queue: { dead_letter: number };
      request_id: string;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.queue.dead_letter).toBe(0);
    expect(body.request_id).toBeTruthy();
  });

  it("ops queue endpoint dead-letter ve backlog gorunurlugunu doner", async () => {
    const oldest = new Date("2026-03-29T10:00:00.000Z");
    const route = await loadOpsQueueRoute(
      createDeps({
        queuedCount: 4,
        retryWaitCount: 2,
        leasedCount: 1,
        runningCount: 3,
        deadLetterCount: 5,
        failedCount: 1,
        oldestQueuedAt: oldest,
        staleLeasedCount: 1,
        staleRunningCount: 2,
      }),
    );

    const response = await route.GET(
      new Request("http://localhost/api/v1/ops/queue", {
        headers: {
          "x-ops-key": "ops_key_for_tests_12345",
        },
      }),
    );
    const body = (await response.json()) as {
      queue: {
        queued: number;
        retry_wait: number;
        dead_letter: number;
        stale_running: number;
        oldest_queued_at: string | null;
      };
      request_id: string;
    };

    expect(response.status).toBe(200);
    expect(body.queue.queued).toBe(4);
    expect(body.queue.retry_wait).toBe(2);
    expect(body.queue.dead_letter).toBe(5);
    expect(body.queue.stale_running).toBe(2);
    expect(body.queue.oldest_queued_at).toBe(oldest.toISOString());
    expect(body.request_id).toBeTruthy();
  });

  it("ops queue endpoint key yoksa 401 doner", async () => {
    const route = await loadOpsQueueRoute(
      createDeps({
        queuedCount: 0,
        retryWaitCount: 0,
        leasedCount: 0,
        runningCount: 0,
        deadLetterCount: 0,
        failedCount: 0,
        oldestQueuedAt: null,
        staleLeasedCount: 0,
        staleRunningCount: 0,
      }),
    );

    const response = await route.GET(
      new Request("http://localhost/api/v1/ops/queue"),
    );
    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
