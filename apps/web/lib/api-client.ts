"use client";

import {
  checkoutResponseSchema,
  creditsResponseSchema,
  generationDetailResponseSchema,
  generationHistoryItemSchema,
  refineGenerationResponseSchema,
  standardErrorSchema,
  submitGenerationResponseSchema,
  type CheckoutRequestDto,
  type CreditsResponseDto,
  type GenerationDetailResponseDto,
  type GenerationRequestDto,
  type RefineRequestDto,
} from "@vi/contracts";
import { getBrowserSupabaseClient } from "./supabase-browser";

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId: string | null;
  public readonly details?: Record<string, unknown>;

  public constructor(params: {
    status: number;
    code: string;
    message: string;
    requestId: string | null;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

interface FetchOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  idempotencyKey?: string;
}

function createIdempotencyKey(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  const fallback = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return `${prefix}-${fallback}`;
}

async function getAccessTokenOrThrow(): Promise<string> {
  const supabase = getBrowserSupabaseClient();
  const { data, error } = await supabase.auth.getSession();

  if (error !== null || data.session?.access_token === undefined) {
    throw new ApiClientError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Oturum gecersiz veya suresi dolmus.",
      requestId: null,
    });
  }

  return data.session.access_token;
}

async function parseError(response: Response): Promise<never> {
  const payload = await response.json().catch(() => null);
  const parsed = standardErrorSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiClientError({
      status: response.status,
      code: "INTERNAL_ERROR",
      message: "Beklenmeyen bir API hatasi olustu.",
      requestId: null,
    });
  }

  throw new ApiClientError({
    status: response.status,
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    requestId: parsed.data.request_id,
    details: parsed.data.error.details,
  });
}

async function apiFetch(path: string, options: FetchOptions = {}): Promise<unknown> {
  const token = await getAccessTokenOrThrow();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    return parseError(response);
  }

  return response.json();
}

export interface GenerationHistoryResponse {
  items: Array<{
    generation_id: string;
    active_run_state: GenerationDetailResponseDto["active_run_state"];
    created_at: string;
    latest_variant_thumbnail_url: string | null;
    total_runs: number;
  }>;
  next_cursor: string | null;
  request_id: string;
}

export async function createGeneration(
  payload: GenerationRequestDto,
): Promise<{
  generationId: string;
  runId: string;
  pollPath: string;
  requestId: string;
}> {
  const idempotencyKey = createIdempotencyKey("gen");

  const raw = await apiFetch("/api/v1/generations", {
    method: "POST",
    body: payload,
    idempotencyKey,
  });

  const parsed = submitGenerationResponseSchema.parse(raw);

  return {
    generationId: parsed.generation_id,
    runId: parsed.run_id,
    pollPath: parsed.poll_path,
    requestId: parsed.request_id,
  };
}

export async function getGenerationDetail(
  generationId: string,
): Promise<GenerationDetailResponseDto> {
  const raw = await apiFetch(`/api/v1/generations/${generationId}`);
  return generationDetailResponseSchema.parse(raw);
}

export async function refineGeneration(params: {
  generationId: string;
  payload: RefineRequestDto;
}): Promise<{ runId: string; requestId: string }> {
  const idempotencyKey = createIdempotencyKey("refine");
  const raw = await apiFetch(`/api/v1/generations/${params.generationId}/refine`, {
    method: "POST",
    body: params.payload,
    idempotencyKey,
  });

  const parsed = refineGenerationResponseSchema.parse(raw);
  return {
    runId: parsed.new_run_id,
    requestId: parsed.request_id,
  };
}

export async function listGenerationHistory(params: {
  limit?: number;
  cursor?: string | null;
} = {}): Promise<GenerationHistoryResponse> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) {
    search.set("limit", String(params.limit));
  }
  if (params.cursor !== undefined && params.cursor !== null) {
    search.set("cursor", params.cursor);
  }

  const query = search.toString();
  const raw = await apiFetch(`/api/v1/generations${query.length > 0 ? `?${query}` : ""}`);

  if (typeof raw !== "object" || raw === null) {
    throw new ApiClientError({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "History yaniti gecersiz.",
      requestId: null,
    });
  }

  const data = raw as {
    items?: unknown[];
    next_cursor?: unknown;
    request_id?: unknown;
  };

  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const items = itemsRaw.map((item) => generationHistoryItemSchema.parse(item));

  return {
    items,
    next_cursor: typeof data.next_cursor === "string" ? data.next_cursor : null,
    request_id: typeof data.request_id === "string" ? data.request_id : "",
  };
}

export async function tryAddFavoriteToApi(imageVariantId: string): Promise<boolean> {
  try {
    await apiFetch(`/api/v1/favorites/${imageVariantId}`, {
      method: "POST",
    });
    return true;
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 405)) {
      return false;
    }
    throw error;
  }
}

export async function tryRemoveFavoriteFromApi(imageVariantId: string): Promise<boolean> {
  try {
    await apiFetch(`/api/v1/favorites/${imageVariantId}`, {
      method: "DELETE",
    });
    return true;
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 405)) {
      return false;
    }
    throw error;
  }
}

export async function getCredits(): Promise<CreditsResponseDto> {
  const raw = await apiFetch("/api/v1/credits");
  return creditsResponseSchema.parse(raw);
}

export async function createBillingCheckout(payload: CheckoutRequestDto): Promise<{
  checkoutSessionId: string;
  checkoutUrl: string;
  requestId: string;
}> {
  const idempotencyKey = createIdempotencyKey("checkout");
  const raw = await apiFetch("/api/v1/billing/checkout", {
    method: "POST",
    body: payload,
    idempotencyKey,
  });
  const parsed = checkoutResponseSchema.parse(raw);
  return {
    checkoutSessionId: parsed.checkout_session_id,
    checkoutUrl: parsed.checkout_url,
    requestId: parsed.request_id,
  };
}
