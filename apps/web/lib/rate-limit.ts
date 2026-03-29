import { RateLimitedAppError, type Logger } from "@vi/application";

interface WindowBucket {
  count: number;
  resetAtMs: number;
}

export interface RateLimitRule {
  scope: string;
  reason: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitInput {
  key: string;
  requestId: string;
  logger: Logger;
  rule: RateLimitRule;
  context?: Record<string, unknown>;
  nowMs?: number;
}

class InMemoryFixedWindowRateLimiter {
  private readonly buckets = new Map<string, WindowBucket>();
  private lastPruneMs = 0;

  public consume(key: string, limit: number, windowMs: number, nowMs: number): {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
    resetAtMs: number;
  } {
    this.prune(nowMs);
    const existing = this.buckets.get(key);

    if (existing === undefined || existing.resetAtMs <= nowMs) {
      const next: WindowBucket = {
        count: 1,
        resetAtMs: nowMs + windowMs,
      };
      this.buckets.set(key, next);
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfterSeconds: Math.ceil(windowMs / 1000),
        resetAtMs: next.resetAtMs,
      };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)),
        resetAtMs: existing.resetAtMs,
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - existing.count),
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)),
      resetAtMs: existing.resetAtMs,
    };
  }

  public resetForTests(): void {
    this.buckets.clear();
    this.lastPruneMs = 0;
  }

  private prune(nowMs: number): void {
    if (nowMs - this.lastPruneMs < 5_000) {
      return;
    }
    this.lastPruneMs = nowMs;
    for (const [key, value] of this.buckets) {
      if (value.resetAtMs <= nowMs) {
        this.buckets.delete(key);
      }
    }
  }
}

const limiterSingleton = new InMemoryFixedWindowRateLimiter();

function normalizedKey(input: string): string {
  return input.trim().toLowerCase();
}

export function enforceRateLimit(input: RateLimitInput): void {
  const nowMs = input.nowMs ?? Date.now();
  const key = `${input.rule.scope}:${normalizedKey(input.key)}`;

  const consumed = limiterSingleton.consume(
    key,
    input.rule.limit,
    input.rule.windowMs,
    nowMs,
  );

  if (consumed.allowed) {
    return;
  }

  input.logger.warn("rate_limit_blocked", {
    requestId: input.requestId,
    scope: input.rule.scope,
    reason: input.rule.reason,
    key,
    retryAfterSeconds: consumed.retryAfterSeconds,
    ...(input.context ?? {}),
  });

  throw new RateLimitedAppError({
    message: "Çok fazla istek gönderildi. Lütfen kısa süre sonra tekrar deneyin.",
    retryAfterSeconds: consumed.retryAfterSeconds,
    scope: input.rule.scope,
    reason: input.rule.reason,
  });
}

export function resetRateLimiterForTests(): void {
  limiterSingleton.resetForTests();
}
