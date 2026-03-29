import { z } from "zod";
import {
  idempotencyKeySchema,
  requestIdSchema,
} from "./common";

export const creditPackCodeSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9_-]+$/);

export const creditPackSchema = z.object({
  code: creditPackCodeSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(240),
  credits: z.number().int().positive(),
  price_cents: z.number().int().positive(),
  currency: z.string().length(3),
});

export const checkoutRequestBodySchema = z.object({
  pack_code: creditPackCodeSchema,
  success_url: z.url().optional(),
  cancel_url: z.url().optional(),
});

export const checkoutResponseSchema = z.object({
  checkout_session_id: z.string().min(1),
  checkout_url: z.url(),
  request_id: requestIdSchema,
});

export const creditsResponseSchema = z.object({
  balance: z.number().int().nonnegative(),
  pending_refund: z.number().int().nonnegative(),
  request_id: requestIdSchema,
});

export const webhookAckResponseSchema = z.object({
  received: z.literal(true),
  duplicate: z.boolean(),
});

export const checkoutIdempotencyHeaderSchema = z.object({
  idempotency_key: idempotencyKeySchema,
});

export type CreditPackDto = z.infer<typeof creditPackSchema>;
export type CheckoutRequestDto = z.infer<typeof checkoutRequestBodySchema>;
export type CheckoutResponseDto = z.infer<typeof checkoutResponseSchema>;
export type CreditsResponseDto = z.infer<typeof creditsResponseSchema>;
export type WebhookAckResponseDto = z.infer<typeof webhookAckResponseSchema>;
