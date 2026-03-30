import { NextResponse } from "next/server";
import {
  publicGalleryQuerySchema,
  publicGalleryResponseSchema,
} from "@vi/contracts";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../../lib/dependencies";
import { parseQuery } from "../../../../../lib/http";
import { getRequestMeta } from "../../../../../lib/request-meta";
import { getOrSetCachedResponse } from "../../../../../lib/response-cache";

export async function GET(request: Request): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const requestMeta = getRequestMeta(request);

  try {
    const query = parseQuery(request.url, publicGalleryQuerySchema);
    const cacheKey = `${query.sort}:${query.filter}:${query.tag ?? ""}:${query.cursor ?? ""}:${query.limit ?? 20}`;
    const cacheTtlSeconds = (deps as {
      config?: { PUBLIC_GALLERY_CACHE_TTL_SECONDS?: number };
    }).config?.PUBLIC_GALLERY_CACHE_TTL_SECONDS ?? 20;
    const cached = await getOrSetCachedResponse({
      namespace: "public_gallery",
      key: cacheKey,
      ttlSeconds: cacheTtlSeconds,
      producer: async () => {
        const computed = await deps.publicGalleryUseCase.list({
          query,
          requestId,
        });
        return {
          items: computed.items,
          next_cursor: computed.next_cursor,
        };
      },
    });
    const response = {
      ...cached.value,
      request_id: requestId,
    };

    deps.logger.info("public_gallery_cache", {
      requestId,
      cacheHit: cached.cacheHit,
      sort: query.sort,
      filter: query.filter,
      limit: query.limit ?? 20,
      hasTag: query.tag !== undefined,
    });

    return NextResponse.json(publicGalleryResponseSchema.parse(response), {
      status: 200,
    });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_public_gallery_get_failed", {
      requestId,
      ipAddress: requestMeta.ipAddress,
      method: "GET",
      route: "/api/v1/public/gallery",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
