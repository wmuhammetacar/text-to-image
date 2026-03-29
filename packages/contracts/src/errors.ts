import { z } from "zod";
import { requestIdSchema } from "./common";

export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "RESOURCE_NOT_FOUND",
  "INSUFFICIENT_CREDITS",
  "IDEMPOTENCY_CONFLICT",
  "GENERATION_BUSY",
  "GENERATION_BLOCKED",
  "SAFETY_SOFT_BLOCK",
  "SAFETY_HARD_BLOCK",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

export const standardErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
  request_id: requestIdSchema,
});

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type StandardErrorDto = z.infer<typeof standardErrorSchema>;
