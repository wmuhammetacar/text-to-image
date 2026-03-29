import {
  ProviderAuthError,
  ProviderInvalidResponseError,
  ProviderRateLimitError,
  ProviderRetryableError,
  ProviderSafetyBlockError,
  ProviderTimeoutError,
} from "./errors";

type FetchFn = typeof fetch;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function containsSafetySignal(raw: string): boolean {
  const lowered = raw.toLowerCase();
  return (
    lowered.includes("safety") ||
    lowered.includes("content policy") ||
    lowered.includes("content_policy") ||
    lowered.includes("policy violation")
  );
}

function parseErrorMessage(payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const root = payload as Record<string, unknown>;
    if (typeof root.message === "string" && root.message.length > 0) {
      return root.message;
    }
    const nested = root.error;
    if (typeof nested === "object" && nested !== null) {
      const nestedRecord = nested as Record<string, unknown>;
      if (typeof nestedRecord.message === "string" && nestedRecord.message.length > 0) {
        return nestedRecord.message;
      }
    }
  }
  return "Provider isteği başarısız oldu.";
}

function classifyHttpError(params: {
  providerName: string;
  status: number;
  payload: unknown;
}): Error {
  const message = parseErrorMessage(params.payload);
  if (params.status === 401 || params.status === 403) {
    return new ProviderAuthError(params.providerName, params.status, message);
  }
  if (params.status === 429) {
    return new ProviderRateLimitError(params.providerName, message);
  }
  if ((params.status === 400 || params.status === 422) && containsSafetySignal(message)) {
    return new ProviderSafetyBlockError(
      params.providerName,
      "PROVIDER_CONTENT_POLICY",
      message,
    );
  }
  if (isRetryableStatus(params.status)) {
    return new ProviderRetryableError({
      providerName: params.providerName,
      message,
      statusCode: params.status,
      code: `PROVIDER_HTTP_${params.status}`,
    });
  }
  return new ProviderInvalidResponseError(params.providerName, message);
}

export interface OpenAiHttpClientOptions {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  fetchFn?: FetchFn;
}

export class OpenAiHttpClient {
  private readonly providerName: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchFn: FetchFn;

  public constructor(options: OpenAiHttpClientOptions) {
    this.providerName = options.providerName;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  public async postJson(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.requestJson("POST", `${this.baseUrl}${path}`, body);
  }

  public async fetchBinary(url: string): Promise<Uint8Array> {
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchFn(url, {
          method: "GET",
          signal: controller.signal,
        });

        if (!response.ok) {
          const parsedPayload = await response.json().catch(() => null);
          const classified = classifyHttpError({
            providerName: this.providerName,
            status: response.status,
            payload: parsedPayload,
          });
          if (
            classified instanceof ProviderRetryableError &&
            attempt < this.maxRetries
          ) {
            attempt += 1;
            continue;
          }
          throw classified;
        }

        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        if (isAbort) {
          if (attempt < this.maxRetries) {
            attempt += 1;
            continue;
          }
          throw new ProviderTimeoutError(this.providerName, this.timeoutMs);
        }

        if (error instanceof ProviderRetryableError) {
          throw error;
        }
        if (
          error instanceof ProviderAuthError ||
          error instanceof ProviderInvalidResponseError ||
          error instanceof ProviderSafetyBlockError
        ) {
          throw error;
        }

        if (attempt < this.maxRetries) {
          attempt += 1;
          continue;
        }

        throw new ProviderRetryableError({
          providerName: this.providerName,
          message: error instanceof Error ? error.message : "Provider ağ hatası",
          code: "PROVIDER_NETWORK_ERROR",
        });
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async requestJson(
    method: "POST" | "GET",
    url: string,
    body: Record<string, unknown> | null,
  ): Promise<unknown> {
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.apiKey}`,
        };

        if (body !== null) {
          headers["Content-Type"] = "application/json";
        }

        const response = await this.fetchFn(url, {
          method,
          headers,
          body: body === null ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const parsedPayload = await response.json().catch(() => null);
          const classified = classifyHttpError({
            providerName: this.providerName,
            status: response.status,
            payload: parsedPayload,
          });
          if (classified instanceof ProviderRetryableError && attempt < this.maxRetries) {
            attempt += 1;
            continue;
          }
          throw classified;
        }

        return response.json().catch(() => {
          throw new ProviderInvalidResponseError(
            this.providerName,
            "Provider JSON döndürmedi.",
          );
        });
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        if (isAbort) {
          if (attempt < this.maxRetries) {
            attempt += 1;
            continue;
          }
          throw new ProviderTimeoutError(this.providerName, this.timeoutMs);
        }

        if (error instanceof ProviderRetryableError) {
          throw error;
        }
        if (
          error instanceof ProviderAuthError ||
          error instanceof ProviderInvalidResponseError ||
          error instanceof ProviderSafetyBlockError
        ) {
          throw error;
        }

        if (attempt < this.maxRetries) {
          attempt += 1;
          continue;
        }

        throw new ProviderRetryableError({
          providerName: this.providerName,
          message: error instanceof Error ? error.message : "Provider ağ hatası",
          code: "PROVIDER_NETWORK_ERROR",
        });
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
