import { RateLimitedAppError, type Logger, type Repository } from "@vi/application";

interface AbuseGuardInput {
  userId: string;
  requestId: string;
  ipAddress: string | null;
}

interface AbuseGuardDeps {
  repository: Repository;
  logger: Logger;
  limits: {
    dailyCreditSpendLimit: number;
    generationRuns10mLimit: number;
    refineRuns10mLimit: number;
    hardBlock30mLimit: number;
  };
}

export class AbuseGuard {
  public constructor(private readonly deps: AbuseGuardDeps) {}

  public async assertGenerationAllowed(input: AbuseGuardInput): Promise<void> {
    const now = new Date();
    const signals = await this.deps.repository.getUserAbuseSignals({
      userId: input.userId,
      now,
    });

    if (signals.generationDebitCreditsLast24h >= this.deps.limits.dailyCreditSpendLimit) {
      this.logSuspicious("daily_credit_spend_limit_hit", input, signals);
      throw new RateLimitedAppError({
        message: "Günlük kredi harcama sınırına ulaştınız. Lütfen daha sonra tekrar deneyin.",
        retryAfterSeconds: 60 * 60,
        scope: "abuse_guard",
        reason: "daily_credit_spend_limit",
      });
    }

    if (signals.generationRunsLast10m >= this.deps.limits.generationRuns10mLimit) {
      this.logSuspicious("generation_spam_pattern", input, signals);
      throw new RateLimitedAppError({
        message: "Kısa sürede çok fazla üretim denemesi yapıldı. Lütfen bekleyip tekrar deneyin.",
        retryAfterSeconds: 10 * 60,
        scope: "abuse_guard",
        reason: "generation_spam",
      });
    }

    if (signals.hardBlocksLast30m >= this.deps.limits.hardBlock30mLimit) {
      this.logSuspicious("hard_block_streak_detected", input, signals);
      throw new RateLimitedAppError({
        message: "Güvenlik nedeniyle istek geçici olarak sınırlandı. Bir süre sonra tekrar deneyin.",
        retryAfterSeconds: 30 * 60,
        scope: "abuse_guard",
        reason: "hard_block_streak",
      });
    }
  }

  public async assertRefineAllowed(input: AbuseGuardInput): Promise<void> {
    const now = new Date();
    const signals = await this.deps.repository.getUserAbuseSignals({
      userId: input.userId,
      now,
    });

    if (signals.refineRunsLast10m >= this.deps.limits.refineRuns10mLimit) {
      this.logSuspicious("refine_spam_pattern", input, signals);
      throw new RateLimitedAppError({
        message: "Refine istekleri kısa sürede sınırı aştı. Lütfen bekleyip tekrar deneyin.",
        retryAfterSeconds: 10 * 60,
        scope: "abuse_guard",
        reason: "refine_spam",
      });
    }

    if (signals.hardBlocksLast30m >= this.deps.limits.hardBlock30mLimit) {
      this.logSuspicious("hard_block_streak_detected", input, signals);
      throw new RateLimitedAppError({
        message: "Güvenlik nedeniyle refine geçici olarak sınırlandı. Daha sonra tekrar deneyin.",
        retryAfterSeconds: 30 * 60,
        scope: "abuse_guard",
        reason: "hard_block_streak",
      });
    }
  }

  private logSuspicious(
    event: string,
    input: AbuseGuardInput,
    signals: Awaited<ReturnType<Repository["getUserAbuseSignals"]>>,
  ): void {
    this.deps.logger.warn("suspicious_activity_detected", {
      requestId: input.requestId,
      userId: input.userId,
      ipAddress: input.ipAddress,
      suspiciousEvent: event,
      signals,
    });
  }
}
