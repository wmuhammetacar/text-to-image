import { z } from "zod";

export const uuidSchema = z.uuid();

export const requestIdSchema = z.string().min(12).max(128);

export const correlationIdSchema = z.uuid();

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, "INVALID_IDEMPOTENCY_KEY_FORMAT");

export const paginationCursorSchema = z.string().min(1).max(512);

export const limitSchema = z.coerce.number().int().min(1).max(50).default(20);

export type RequestId = z.infer<typeof requestIdSchema>;
export type CorrelationId = z.infer<typeof correlationIdSchema>;
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

export interface RequestMetaDto {
  request_id: RequestId;
  correlation_id?: CorrelationId;
}

export interface CursorPageDto<TItem> {
  items: TItem[];
  next_cursor: string | null;
  request_id: RequestId;
}
