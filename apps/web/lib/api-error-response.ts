import type { StandardErrorDto } from "@vi/contracts";
import { NextResponse } from "next/server";

export function createApiErrorResponse(mapped: {
  status: number;
  body: StandardErrorDto;
}): Response {
  const headers = new Headers();
  headers.set("X-Request-Id", mapped.body.request_id);

  if (mapped.body.error.code === "RATE_LIMITED") {
    const retryAfter = mapped.body.error.details?.retry_after_seconds;
    if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0) {
      headers.set("Retry-After", String(Math.ceil(retryAfter)));
    }
  }

  return NextResponse.json(mapped.body, {
    status: mapped.status,
    headers,
  });
}
