import type { ErrorCode } from "@vi/contracts";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;
  public readonly retryable: boolean;

  public constructor(params: {
    code: ErrorCode;
    message: string;
    httpStatus: number;
    details?: Record<string, unknown>;
    retryable?: boolean;
  }) {
    super(params.message);
    this.code = params.code;
    this.httpStatus = params.httpStatus;
    this.details = params.details;
    this.retryable = params.retryable ?? false;
  }
}

export class ValidationAppError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: "VALIDATION_ERROR",
      message,
      details,
      httpStatus: 400,
    });
  }
}

export class BillingPackNotFoundError extends ValidationAppError {
  public constructor(packCode: string) {
    super("Gecersiz kredi paketi.", {
      pack_code: packCode,
    });
  }
}

export class BillingRedirectUrlError extends ValidationAppError {
  public constructor(field: "success_url" | "cancel_url") {
    super(`${field} uygulama origin'i disina cikamaz.`, {
      field,
    });
  }
}

export class UnauthorizedAppError extends AppError {
  public constructor() {
    super({
      code: "UNAUTHORIZED",
      message: "Yetkilendirme gerekli.",
      httpStatus: 401,
    });
  }
}

export class NotFoundAppError extends AppError {
  public constructor(resource: string) {
    super({
      code: "RESOURCE_NOT_FOUND",
      message: `${resource} bulunamadi.`,
      httpStatus: 404,
    });
  }
}

export class IdempotencyConflictError extends AppError {
  public constructor() {
    super({
      code: "IDEMPOTENCY_CONFLICT",
      message: "Ayni idempotency key farkli payload ile kullanildi.",
      httpStatus: 409,
    });
  }
}

export class InsufficientCreditsError extends AppError {
  public constructor() {
    super({
      code: "INSUFFICIENT_CREDITS",
      message: "Yetersiz kredi.",
      httpStatus: 402,
    });
  }
}

export class GenerationBusyError extends AppError {
  public constructor() {
    super({
      code: "GENERATION_BUSY",
      message: "Generation aktif run tamamlanmadan refine edilemez.",
      httpStatus: 409,
    });
  }
}

export class GenerationBlockedError extends AppError {
  public constructor() {
    super({
      code: "GENERATION_BLOCKED",
      message: "Bloklu generation refine edilemez.",
      httpStatus: 409,
    });
  }
}

export class SafetySoftBlockError extends AppError {
  public constructor(message = "Istek guvenlik nedeniyle duzenlenmelidir.") {
    super({
      code: "SAFETY_SOFT_BLOCK",
      message,
      httpStatus: 422,
    });
  }
}

export class SafetyHardBlockError extends AppError {
  public constructor(message = "Istek guvenlik politikasi nedeniyle engellendi.") {
    super({
      code: "SAFETY_HARD_BLOCK",
      message,
      httpStatus: 422,
    });
  }
}

export class InvalidStripeSignatureError extends AppError {
  public constructor() {
    super({
      code: "VALIDATION_ERROR",
      message: "Stripe imzasi gecersiz.",
      httpStatus: 400,
    });
  }
}

export class BillingGatewayError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: "INTERNAL_ERROR",
      message,
      details,
      httpStatus: 502,
    });
  }
}

export class BillingRateLimitedError extends AppError {
  public constructor(message = "Billing servisi hiz sinirina takildi.") {
    super({
      code: "RATE_LIMITED",
      message,
      httpStatus: 429,
    });
  }
}

export class RateLimitedAppError extends AppError {
  public constructor(params: {
    message: string;
    retryAfterSeconds: number;
    scope: string;
    reason: string;
  }) {
    super({
      code: "RATE_LIMITED",
      message: params.message,
      httpStatus: 429,
      details: {
        retry_after_seconds: params.retryAfterSeconds,
        scope: params.scope,
        reason: params.reason,
      },
    });
  }
}

export class RetryablePipelineError extends Error {
  public readonly code: string;

  public constructor(message: string, code = "RETRYABLE_PIPELINE_ERROR") {
    super(message);
    this.code = code;
  }
}
