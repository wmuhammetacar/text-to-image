import { z } from "zod";
import {
  correlationIdSchema,
  idempotencyKeySchema,
  limitSchema,
  paginationCursorSchema,
  requestIdSchema,
  uuidSchema,
} from "./common";

export const creativeModeSchema = z.enum(["fast", "balanced", "directed"]);

export const controlValueSchema = z.number().int().min(-2).max(2);

export const controlsSchema = z
  .object({
    darkness: controlValueSchema.optional(),
    calmness: controlValueSchema.optional(),
    nostalgia: controlValueSchema.optional(),
    cinematic: controlValueSchema.optional(),
  })
  .default({});

export const generationRequestBodySchema = z.object({
  text: z.string().min(1).max(5000),
  requested_image_count: z.number().int().min(1).max(4),
  creative_mode: creativeModeSchema.default("balanced"),
  controls: controlsSchema,
});

export const refineRequestBodySchema = z.object({
  refinement_instruction: z.string().min(1).max(280),
  controls_delta: controlsSchema,
  requested_image_count: z.number().int().min(1).max(4),
});

export const generationStateSchema = z.enum([
  "active",
  "completed",
  "partially_completed",
  "failed",
  "blocked",
]);

export const activeRunStateSchema = z.enum([
  "queued",
  "analyzing",
  "planning",
  "generating",
  "refining",
  "completed",
  "partially_completed",
  "failed",
  "blocked",
  "refunded",
]);

export const runRefundStateSchema = z.enum([
  "none",
  "full_refunded",
  "prorata_refunded",
]);

export const submitGenerationResponseSchema = z.object({
  generation_id: uuidSchema,
  run_id: uuidSchema,
  active_run_state: z.literal("queued"),
  requested_image_count: z.number().int().min(1).max(4),
  poll_path: z.string().min(1),
  request_id: requestIdSchema,
  correlation_id: correlationIdSchema,
});

export const refineGenerationResponseSchema = z.object({
  generation_id: uuidSchema,
  new_run_id: uuidSchema,
  generation_state: z.literal("active"),
  active_run_state: z.literal("queued"),
  poll_path: z.string().min(1),
  request_id: requestIdSchema,
  correlation_id: correlationIdSchema,
});

export const generationHistoryQuerySchema = z.object({
  limit: limitSchema.optional(),
  cursor: paginationCursorSchema.optional(),
});

export const generationHistoryItemSchema = z.object({
  generation_id: uuidSchema,
  active_run_state: activeRunStateSchema,
  created_at: z.iso.datetime({ offset: true }),
  latest_variant_thumbnail_url: z.string().url().nullable(),
  total_runs: z.number().int().min(0),
});

export const runDetailSchema = z.object({
  run_id: uuidSchema,
  pipeline_state: activeRunStateSchema,
  attempt: z.number().int().min(1),
  created_at: z.iso.datetime({ offset: true }),
  completed_at: z.iso.datetime({ offset: true }).nullable(),
  refund_state: runRefundStateSchema,
});

export const variantDetailSchema = z.object({
  image_variant_id: uuidSchema,
  run_id: uuidSchema,
  variant_index: z.number().int().min(1).max(4),
  status: z.enum(["completed", "blocked", "failed"]),
  signed_url: z.string().url().nullable(),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
});

export const generationDetailResponseSchema = z.object({
  generation_id: uuidSchema,
  generation_state: generationStateSchema,
  active_run_id: uuidSchema.nullable(),
  active_run_state: activeRunStateSchema,
  runs: z.array(runDetailSchema),
  variants: z.array(variantDetailSchema),
  request_id: requestIdSchema,
  correlation_id: correlationIdSchema.nullable(),
});

export const idempotencyHeaderSchema = z.object({
  idempotency_key: idempotencyKeySchema,
});

export type GenerationRequestDto = z.infer<typeof generationRequestBodySchema>;
export type RefineRequestDto = z.infer<typeof refineRequestBodySchema>;
export type SubmitGenerationResponseDto = z.infer<typeof submitGenerationResponseSchema>;
export type RefineGenerationResponseDto = z.infer<typeof refineGenerationResponseSchema>;
export type GenerationDetailResponseDto = z.infer<typeof generationDetailResponseSchema>;
export type GenerationHistoryItemDto = z.infer<typeof generationHistoryItemSchema>;
export type IdempotencyHeaderDto = z.infer<typeof idempotencyHeaderSchema>;
