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
export const generationVisibilitySchema = z.enum(["private", "unlisted", "public"]);

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

export const variationTypeSchema = z.enum([
  "more_dramatic",
  "more_minimal",
  "more_realistic",
  "more_stylized",
  "change_lighting",
  "change_environment",
  "change_mood",
  "increase_detail",
  "simplify_scene",
  "keep_subject_change_environment",
  "keep_composition_change_style",
  "keep_mood_change_realism",
  "keep_style_change_subject",
  "upscale",
]);

export const variationParametersSchema = z.record(z.string(), z.unknown()).default({});

export const variationRequestBodySchema = z.object({
  base_variant_id: uuidSchema,
  variation_type: variationTypeSchema,
  variation_parameters: variationParametersSchema.optional().default({}),
  requested_image_count: z.number().int().min(1).max(4).default(1),
  remix_source_type: z.enum(["public_generation"]).optional(),
  remix_source_generation_id: uuidSchema.optional(),
  remix_source_variant_id: uuidSchema.optional(),
});

export const upscaleRequestBodySchema = z.object({
  variant_id: uuidSchema,
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

export const submitVariationResponseSchema = z.object({
  generation_id: uuidSchema,
  variation_request_id: uuidSchema,
  new_run_id: uuidSchema,
  active_run_state: z.literal("queued"),
  variation_type: variationTypeSchema,
  poll_path: z.string().min(1),
  request_id: requestIdSchema,
  correlation_id: correlationIdSchema,
});

export const submitUpscaleResponseSchema = z.object({
  generation_id: uuidSchema,
  variation_request_id: uuidSchema,
  new_run_id: uuidSchema,
  base_variant_id: uuidSchema,
  active_run_state: z.literal("queued"),
  variation_type: z.literal("upscale"),
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

export const generationPassTypeSchema = z.enum([
  "concept",
  "composition",
  "detail",
  "enhancement",
]);

export const generationPassStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const generationPassDetailSchema = z.object({
  pass_id: uuidSchema,
  run_id: uuidSchema,
  pass_type: generationPassTypeSchema,
  pass_index: z.number().int().min(1).max(4),
  status: generationPassStatusSchema,
  summary: z.string().min(1).nullable(),
  input_artifact_count: z.number().int().min(0),
  output_artifact_count: z.number().int().min(0),
  started_at: z.iso.datetime({ offset: true }).nullable(),
  completed_at: z.iso.datetime({ offset: true }).nullable(),
});

export const variantDetailSchema = z.object({
  image_variant_id: uuidSchema,
  run_id: uuidSchema,
  variant_index: z.number().int().min(1).max(4),
  parent_variant_id: uuidSchema.nullable(),
  variation_type: variationTypeSchema.nullable(),
  is_upscaled: z.boolean(),
  branch_depth: z.number().int().min(0),
  status: z.enum(["completed", "blocked", "failed"]),
  signed_url: z.string().url().nullable(),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
});

export const userIntentSchema = z.object({
  summary: z.string().min(1),
  subjects: z.array(z.string().min(1)),
  visual_goal: z.string().min(1),
  narrative_intent: z.string().min(1),
  style_hints: z.array(z.string().min(1)),
  forbidden_elements: z.array(z.string().min(1)),
});

export const emotionProfileSchema = z.object({
  dominant_emotion: z.string().min(1),
  secondary_emotions: z.array(z.string().min(1)),
  intensity: z.number().min(1).max(10),
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  atmosphere: z.array(z.string().min(1)),
  themes: z.array(z.string().min(1)),
  emotional_tone: z.string().min(1),
});

export const creativeDirectionSchema = z.object({
  direction_id: uuidSchema,
  direction_index: z.number().int().min(1),
  title: z.string().min(1),
  creative_type: z.enum([
    "cinematic",
    "editorial",
    "atmospheric",
    "surreal",
    "minimal",
    "expressive",
    "documentary",
    "dreamy",
  ]),
  description: z.string().min(1),
  narrative_intent: z.string().min(1),
  style_tags: z.array(z.string().min(1)).min(1),
  composition: z.object({
    shot_type: z.string().min(1),
    camera_distance: z.string().min(1),
    camera_angle: z.string().min(1),
    depth: z.string().min(1),
    scene_density: z.enum(["low", "medium", "high"]),
  }),
  lighting: z.object({
    type: z.string().min(1),
    direction: z.string().min(1),
    intensity: z.number().min(0).max(1),
  }),
  color_palette: z.object({
    primary: z.string().min(1),
    secondary: z.string().min(1),
    mood: z.string().min(1),
  }),
  atmosphere: z.object({
    emotional_tone: z.string().min(1),
    environment_feel: z.string().min(1),
    emotional_rendering_style: z.string().min(1),
  }),
  symbolism_level: z.number().min(0).max(1),
  realism_level: z.number().min(0).max(1),
  stylization_level: z.number().min(0).max(1),
  scores: z.object({
    intent_match_score: z.number().min(0).max(1),
    emotion_match_score: z.number().min(0).max(1),
    visual_novelty_score: z.number().min(0).max(1),
    composition_strength_score: z.number().min(0).max(1),
    controllability_score: z.number().min(0).max(1),
    total_score: z.number().min(0).max(1),
  }),
  rejection_reason: z.string().min(1).nullable(),
});

export const visualPlanSchema = z.object({
  selected_direction_id: uuidSchema.nullable(),
  summary: z.string().min(1),
  prompt_core: z.string().min(1),
  prompt_expanded: z.string().min(1),
  negative_prompt: z.string().min(1),
  subject_definition: z.string().min(1),
  subject_priority: z.array(z.string().min(1)).min(1),
  scene_structure: z.string().min(1),
  focal_hierarchy: z.array(z.string().min(1)).min(1),
  framing: z.string().min(1),
  perspective: z.string().min(1),
  camera_language: z.string().min(1),
  material_texture_bias: z.string().min(1),
  background_complexity: z.enum(["low", "medium", "high"]),
  motion_energy: z.enum(["low", "medium", "high"]),
  symbolism_policy: z.string().min(1),
  realism_level: z.number().min(0).max(1),
  stylization_level: z.number().min(0).max(1),
  keep_constraints: z.array(z.string().min(1)),
  avoid_constraints: z.array(z.string().min(1)),
  composition_plan: z.object({
    framing: z.string().min(1),
    subject_placement: z.string().min(1),
  }),
  lighting_plan: z.object({
    key_light: z.string().min(1),
    fill_light: z.string().min(1),
    rim_light: z.string().min(1),
    contrast: z.string().min(1),
    intensity: z.number().min(0).max(1),
    logic: z.string().min(1),
    notes: z.string().min(1),
  }),
  color_strategy: z.object({
    primary: z.string().min(1),
    secondary: z.string().min(1),
    mood: z.string().min(1),
    saturation: z.string().min(1),
    strategy: z.string().min(1),
  }),
  detail_density: z.enum(["low", "medium", "high"]),
  render_intent: z.enum(["realistic", "artistic", "hybrid"]),
  constraints: z.object({
    forbidden_elements: z.array(z.string().min(1)),
    safety_constraints: z.array(z.string().min(1)),
  }),
});

export const explainabilitySchema = z.object({
  summary: z.string().min(1),
  dominant_interpretation: z.string().min(1),
  why_selected_direction: z.string().min(1),
  why_not_other_directions: z.array(z.string().min(1)),
  emotion_to_visual_mapping: z.string().min(1),
  intent_to_composition_mapping: z.string().min(1),
  style_reasoning: z.string().min(1),
  ambiguity_notes: z.string().min(1),
  ambiguity_score: z.number().min(0).max(1),
  ambiguity_reasons: z.array(z.string().min(1)),
  inferred_assumptions: z.array(z.string().min(1)),
  derived_from: z
    .array(z.enum(["user_intent", "emotion_analysis", "creative_direction"]))
    .min(1),
  output_quality_summary: z.string().min(1).nullable().optional(),
});

export const qualitySignalsSchema = z.object({
  direction_count: z.number().int().min(1),
  selected_direction_score: z.number().min(0).max(1),
  score_spread: z.number().min(0).max(1),
  ambiguity_score: z.number().min(0).max(1),
  prompt_density_score: z.number().min(0).max(1),
  control_signal_strength: z.number().min(0).max(1),
  best_variant_score: z.number().min(0).max(1),
  evaluated_variant_count: z.number().int().min(0),
  enhancement_applied: z.boolean(),
});

export const variantQualityScoreSchema = z.object({
  image_variant_id: uuidSchema,
  variant_index: z.number().int().min(1).max(4),
  aesthetic_score: z.number().min(0).max(1),
  prompt_alignment_score: z.number().min(0).max(1),
  clarity_score: z.number().min(0).max(1),
  composition_score: z.number().min(0).max(1),
  novelty_score: z.number().min(0).max(1),
  total_score: z.number().min(0).max(1),
  is_best: z.boolean(),
});

export const generationDetailResponseSchema = z.object({
  generation_id: uuidSchema,
  generation_state: generationStateSchema,
  visibility: generationVisibilitySchema,
  share_slug: z.string().min(6),
  published_at: z.iso.datetime({ offset: true }).nullable(),
  featured_variant_id: uuidSchema.nullable(),
  active_run_id: uuidSchema.nullable(),
  active_run_state: activeRunStateSchema,
  user_intent: userIntentSchema.nullable(),
  emotion_profile: emotionProfileSchema.nullable(),
  creative_directions: z.array(creativeDirectionSchema),
  selected_direction: creativeDirectionSchema
    .extend({
      selection_reason: z.string().min(1),
    })
    .nullable(),
  visual_plan: visualPlanSchema.nullable(),
  explainability: explainabilitySchema.nullable(),
  quality_signals: qualitySignalsSchema.nullable(),
  variant_scores: z.array(variantQualityScoreSchema),
  best_variant_id: uuidSchema.nullable(),
  passes: z.array(generationPassDetailSchema),
  runs: z.array(runDetailSchema),
  variants: z.array(variantDetailSchema),
  request_id: requestIdSchema,
  correlation_id: correlationIdSchema.nullable(),
});

export const generationVisibilityUpdateBodySchema = z.object({
  visibility: generationVisibilitySchema,
  featured_variant_id: uuidSchema.nullable().optional(),
});

export const generationVisibilityUpdateResponseSchema = z.object({
  generation_id: uuidSchema,
  visibility: generationVisibilitySchema,
  share_slug: z.string().min(6),
  share_path: z.string().min(1),
  published_at: z.iso.datetime({ offset: true }).nullable(),
  featured_variant_id: uuidSchema.nullable(),
  request_id: requestIdSchema,
});

export const publicGallerySortSchema = z.enum([
  "newest",
  "trending",
  "most_remixed",
  "most_refined",
  "most_varied",
  "most_cinematic",
  "most_surreal",
  "best_quality",
]);

export const publicGalleryFilterSchema = z.enum([
  "all",
  "high_quality",
  "high_remix",
  "cinematic",
  "surreal",
]);

export const publicGalleryQuerySchema = z.object({
  limit: limitSchema.optional(),
  cursor: paginationCursorSchema.optional(),
  sort: publicGallerySortSchema.optional().default("newest"),
  filter: publicGalleryFilterSchema.optional().default("all"),
  tag: z.string().min(2).max(64).optional(),
});

export const publicGalleryItemSchema = z.object({
  generation_id: uuidSchema,
  share_slug: z.string().min(6),
  visibility: z.literal("public"),
  published_at: z.iso.datetime({ offset: true }),
  creator_display_name: z.string().min(1),
  creator_profile_handle: z.string().min(3).max(40),
  summary: z.string().min(1),
  style_tags: z.array(z.string().min(1)),
  mood_tags: z.array(z.string().min(1)),
  featured_image_url: z.string().url().nullable(),
  total_runs: z.number().int().min(1),
  variation_count: z.number().int().min(0),
  refinement_count: z.number().int().min(0),
  remix_count: z.number().int().min(0),
  branch_count: z.number().int().min(0),
  total_public_variants: z.number().int().min(0),
  creator_public_generation_count: z.number().int().min(0),
  quality_score: z.number().min(0).max(100),
  ranking_score: z.number().min(0).max(100),
  sort_reason: z.string().min(1),
  featured: z.boolean(),
  discovery_badges: z.array(z.string().min(1)),
});

export const publicGalleryResponseSchema = z.object({
  items: z.array(publicGalleryItemSchema),
  next_cursor: z.string().nullable(),
  request_id: requestIdSchema,
});

export const publicGenerationDetailResponseSchema = z.object({
  generation_id: uuidSchema,
  share_slug: z.string().min(6),
  visibility: z.enum(["public", "unlisted"]),
  published_at: z.iso.datetime({ offset: true }).nullable(),
  creator_display_name: z.string().min(1),
  creator_profile_handle: z.string().min(3).max(40),
  summary: z.string().min(1),
  selected_direction_title: z.string().min(1).nullable(),
  visual_plan_summary: z.string().min(1).nullable(),
  explainability_summary: z.string().min(1).nullable(),
  emotion_to_visual_mapping: z.string().min(1).nullable(),
  style_tags: z.array(z.string().min(1)),
  mood_tags: z.array(z.string().min(1)),
  featured_variant: z.object({
    image_variant_id: uuidSchema,
    signed_url: z.string().url().nullable(),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
    branch_depth: z.number().int().min(0),
    variation_type: variationTypeSchema.nullable(),
    is_upscaled: z.boolean(),
  }).nullable(),
  variants: z.array(z.object({
    image_variant_id: uuidSchema,
    signed_url: z.string().url().nullable(),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
    branch_depth: z.number().int().min(0),
    variation_type: variationTypeSchema.nullable(),
    is_upscaled: z.boolean(),
  })),
  remix: z.object({
    enabled: z.boolean(),
    base_variant_id: uuidSchema.nullable(),
    source_generation_id: uuidSchema,
    source_variant_id: uuidSchema.nullable(),
    remix_source_type: z.literal("public_generation"),
  }),
  lineage: z.object({
    remix_depth: z.number().int().min(0),
    root_public_generation_id: uuidSchema.nullable(),
    root_creator_id: uuidSchema.nullable(),
    remix_source_generation_id: uuidSchema.nullable(),
    remix_source_variant_id: uuidSchema.nullable(),
    derived_public_generation_count: z.number().int().min(0),
    derived_public_generation_ids: z.array(uuidSchema),
  }),
  social_proof: z.object({
    remix_count: z.number().int().min(0),
    branch_count: z.number().int().min(0),
    total_public_variants: z.number().int().min(0),
    creator_public_generation_count: z.number().int().min(0),
  }),
  creator_more_public: z.array(z.object({
    generation_id: uuidSchema,
    share_slug: z.string().min(6),
    summary: z.string().min(1),
    published_at: z.iso.datetime({ offset: true }),
    featured_image_url: z.string().url().nullable(),
    remix_count: z.number().int().min(0),
    quality_score: z.number().min(0).max(100),
  })),
  request_id: requestIdSchema,
});

export const idempotencyHeaderSchema = z.object({
  idempotency_key: idempotencyKeySchema,
});

export type GenerationRequestDto = z.infer<typeof generationRequestBodySchema>;
export type RefineRequestDto = z.infer<typeof refineRequestBodySchema>;
export type VariationRequestDto = z.infer<typeof variationRequestBodySchema>;
export type UpscaleRequestDto = z.infer<typeof upscaleRequestBodySchema>;
export type SubmitGenerationResponseDto = z.infer<typeof submitGenerationResponseSchema>;
export type RefineGenerationResponseDto = z.infer<typeof refineGenerationResponseSchema>;
export type SubmitVariationResponseDto = z.infer<typeof submitVariationResponseSchema>;
export type SubmitUpscaleResponseDto = z.infer<typeof submitUpscaleResponseSchema>;
export type GenerationDetailResponseDto = z.infer<typeof generationDetailResponseSchema>;
export type GenerationHistoryItemDto = z.infer<typeof generationHistoryItemSchema>;
export type IdempotencyHeaderDto = z.infer<typeof idempotencyHeaderSchema>;
export type UserIntentDto = z.infer<typeof userIntentSchema>;
export type EmotionProfileDto = z.infer<typeof emotionProfileSchema>;
export type CreativeDirectionDto = z.infer<typeof creativeDirectionSchema>;
export type VisualPlanDto = z.infer<typeof visualPlanSchema>;
export type ExplainabilityDto = z.infer<typeof explainabilitySchema>;
export type VariantQualityScoreDto = z.infer<typeof variantQualityScoreSchema>;
export type GenerationVisibilityUpdateRequestDto = z.infer<typeof generationVisibilityUpdateBodySchema>;
export type GenerationVisibilityUpdateResponseDto = z.infer<typeof generationVisibilityUpdateResponseSchema>;
export type PublicGalleryQueryDto = z.infer<typeof publicGalleryQuerySchema>;
export type PublicGalleryResponseDto = z.infer<typeof publicGalleryResponseSchema>;
export type PublicGenerationDetailResponseDto = z.infer<typeof publicGenerationDetailResponseSchema>;
