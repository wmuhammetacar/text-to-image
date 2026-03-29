import { describe, expect, it, vi } from "vitest";
import { ValidationAppError } from "@vi/application";
import { standardErrorSchema } from "@vi/contracts";
import { JsonConsoleLogger, toStandardError } from "@vi/observability";

describe("Observability ve error normalization", () => {
  it("secret alanlari logda redacted olur", () => {
    const logger = new JsonConsoleLogger();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
      return;
    });

    logger.error("secret_test", {
      requestId: "req_obs_0001",
      stripeSecretKey: "sk_test_should_not_log",
      authorization: "Bearer token",
      nested: {
        openai_api_key: "openai_secret",
      },
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const payload = String(consoleSpy.mock.calls[0]?.[0]);
    expect(payload).not.toContain("sk_test_should_not_log");
    expect(payload).not.toContain("openai_secret");
    expect(payload).not.toContain("Bearer token");
    expect(payload).toContain("[REDACTED]");
  });

  it("request_id ve correlation_id log contextinde korunur", () => {
    const logger = new JsonConsoleLogger();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {
      return;
    });

    logger.info("correlation_test", {
      requestId: "req_obs_0002",
      correlationId: "corr_obs_0002",
      runId: "run_obs_0002",
    });

    const payload = String(consoleSpy.mock.calls[0]?.[0] ?? "");
    expect(payload).toContain("\"requestId\":\"req_obs_0002\"");
    expect(payload).toContain("\"correlationId\":\"corr_obs_0002\"");
  });

  it("standard error shape bozulmaz", () => {
    const mapped = toStandardError(
      new ValidationAppError("Payload gecersiz."),
      "req_obs_0003",
    );

    const parsed = standardErrorSchema.safeParse(mapped.body);
    expect(mapped.status).toBe(400);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.request_id).toBe("req_obs_0003");
      expect(parsed.data.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
