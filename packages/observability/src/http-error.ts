import type { StandardErrorDto } from "@vi/contracts";
import { AppError } from "@vi/application";

function isAppErrorLike(
  error: unknown,
): error is Pick<AppError, "code" | "httpStatus" | "message" | "details"> {
  if (error instanceof AppError) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.httpStatus === "number" &&
    typeof candidate.message === "string"
  );
}

export function toStandardError(error: unknown, requestId: string): {
  status: number;
  body: StandardErrorDto;
} {
  if (isAppErrorLike(error)) {
    return {
      status: error.httpStatus,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
        request_id: requestId,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Beklenmeyen bir hata olustu.",
      },
      request_id: requestId,
    },
  };
}
