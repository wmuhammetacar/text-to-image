import { NextResponse } from "next/server";
import { publicGenerationDetailResponseSchema } from "@vi/contracts";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../../../lib/dependencies";
import { getRequestMeta } from "../../../../../../lib/request-meta";
import { getOrSetCachedResponse } from "../../../../../../lib/response-cache";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const requestMeta = getRequestMeta(request);

  try {
    const { slug } = await context.params;
    const cacheTtlSeconds = (deps as {
      config?: { PUBLIC_GENERATION_CACHE_TTL_SECONDS?: number };
    }).config?.PUBLIC_GENERATION_CACHE_TTL_SECONDS ?? 30;
    const cached = await getOrSetCachedResponse({
      namespace: "public_generation",
      key: slug,
      ttlSeconds: cacheTtlSeconds,
      producer: async () => {
        const computed = await deps.publicGalleryUseCase.getByShareSlug({
          shareSlug: slug,
          includeUnlisted: true,
          requestId,
        });
        return {
          ...computed,
          request_id: "",
        };
      },
    });
    const response = {
      ...cached.value,
      request_id: requestId,
    };

    deps.logger.info("public_generation_cache", {
      requestId,
      shareSlug: slug,
      cacheHit: cached.cacheHit,
    });

    return NextResponse.json(publicGenerationDetailResponseSchema.parse(response), {
      status: 200,
    });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_public_generation_detail_get_failed", {
      requestId,
      ipAddress: requestMeta.ipAddress,
      method: "GET",
      route: "/api/v1/public/generations/:slug",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
