export const generationStates = [
  "active",
  "completed",
  "partially_completed",
  "failed",
  "blocked",
] as const;

export type GenerationState = (typeof generationStates)[number];

export const generationRefundStates = [
  "none",
  "full_refunded",
  "prorata_refunded",
] as const;

export type GenerationRefundState = (typeof generationRefundStates)[number];

export const generationRunPipelineStates = [
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
] as const;

export type GenerationRunPipelineState = (typeof generationRunPipelineStates)[number];

export const generationRunTerminalStates = [
  "completed",
  "partially_completed",
  "failed",
  "blocked",
  "refunded",
] as const;

export type GenerationRunTerminalState = (typeof generationRunTerminalStates)[number];

export const jobQueueStates = [
  "queued",
  "leased",
  "running",
  "retry_wait",
  "completed",
  "failed",
  "cancelled",
  "dead_letter",
] as const;

export type JobQueueState = (typeof jobQueueStates)[number];

export const moderationStages = [
  "input_moderation",
  "pre_generation_shaping",
  "output_moderation",
] as const;

export type ModerationStage = (typeof moderationStages)[number];

export const moderationDecisions = [
  "allow",
  "sanitize",
  "soft_block",
  "hard_block",
  "review",
] as const;

export type ModerationDecision = (typeof moderationDecisions)[number];

export const billingEventStates = [
  "received",
  "validated",
  "applying",
  "completed",
  "failed",
  "refunded",
  "ignored_duplicate",
] as const;

export type BillingEventState = (typeof billingEventStates)[number];
