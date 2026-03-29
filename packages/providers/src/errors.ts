import {
  RetryablePipelineError,
  SafetyHardBlockError,
} from "@vi/application";

export class ProviderConfigurationError extends Error {
  public readonly code: string;

  public constructor(message: string, code = "PROVIDER_CONFIGURATION_ERROR") {
    super(message);
    this.code = code;
  }
}

export class ProviderInvalidResponseError extends Error {
  public readonly code: string;
  public readonly providerName: string;

  public constructor(providerName: string, message: string, code = "PROVIDER_INVALID_RESPONSE") {
    super(message);
    this.code = code;
    this.providerName = providerName;
  }
}

export class ProviderAuthError extends Error {
  public readonly code: string;
  public readonly providerName: string;
  public readonly statusCode: number;

  public constructor(providerName: string, statusCode: number, message: string) {
    super(message);
    this.code = "PROVIDER_AUTH_ERROR";
    this.providerName = providerName;
    this.statusCode = statusCode;
  }
}

export class ProviderRetryableError extends RetryablePipelineError {
  public readonly providerName: string;
  public readonly statusCode?: number;

  public constructor(params: {
    providerName: string;
    message: string;
    code?: string;
    statusCode?: number;
  }) {
    super(params.message, params.code ?? "PROVIDER_RETRYABLE_ERROR");
    this.providerName = params.providerName;
    this.statusCode = params.statusCode;
  }
}

export class ProviderRateLimitError extends ProviderRetryableError {
  public constructor(providerName: string, message = "Provider rate limit aşıldı.") {
    super({
      providerName,
      message,
      code: "PROVIDER_RATE_LIMIT",
      statusCode: 429,
    });
  }
}

export class ProviderTimeoutError extends ProviderRetryableError {
  public constructor(providerName: string, timeoutMs: number) {
    super({
      providerName,
      message: `Provider timeout: ${timeoutMs}ms`,
      code: "PROVIDER_TIMEOUT",
    });
  }
}

export class ProviderSafetyBlockError extends SafetyHardBlockError {
  public readonly providerName: string;
  public readonly policyCode: string;

  public constructor(providerName: string, policyCode: string, message: string) {
    super(message);
    this.providerName = providerName;
    this.policyCode = policyCode;
  }
}
