-- ADIM 2 / Migration 0001
-- Temel şema, tablo ve state sözleşmeleri

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------
-- Yardımcı fonksiyonlar
-- -----------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_credit_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'credit_ledger_entries append-only tablodur, update/delete yasak';
end;
$$;

-- -----------------------------------------------------
-- Profiller (kullanıcı kökü)
-- -----------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  email text,
  display_name text not null,
  segment text not null default 'b2c'
    check (segment in ('b2c', 'pro_creator', 'b2b')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- Kredi hesap projeksiyonu
-- -----------------------------------------------------
create table if not exists public.credit_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique
    references public.profiles(user_id) on delete cascade,
  balance integer not null default 0,
  pending_refund integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_accounts_balance_non_negative check (balance >= 0),
  constraint credit_accounts_pending_refund_non_negative check (pending_refund >= 0)
);

create trigger trg_credit_accounts_set_updated_at
before update on public.credit_accounts
for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- Generation aggregate root
-- -----------------------------------------------------
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  state text not null default 'active'
    check (state in ('active', 'completed', 'partially_completed', 'failed', 'blocked')),
  refund_state text not null default 'none'
    check (refund_state in ('none', 'full_refunded', 'prorata_refunded')),
  active_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_generations_set_updated_at
before update on public.generations
for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- Generation request (immutable giriş)
-- -----------------------------------------------------
create table if not exists public.generation_requests (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  source_text text not null,
  requested_image_count integer not null
    check (requested_image_count between 1 and 4),
  creative_mode text not null default 'balanced'
    check (creative_mode in ('fast', 'balanced', 'directed')),
  controls_json jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint generation_requests_controls_json_is_object
    check (jsonb_typeof(controls_json) = 'object')
);

-- -----------------------------------------------------
-- Refinement instruction (ayrı entity)
-- -----------------------------------------------------
create table if not exists public.refinement_instructions (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  based_on_run_id uuid,
  instruction_text text not null,
  controls_delta_json jsonb not null default '{}'::jsonb,
  requested_image_count integer not null
    check (requested_image_count between 1 and 4),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint refinement_instructions_controls_delta_json_is_object
    check (jsonb_typeof(controls_delta_json) = 'object')
);

-- -----------------------------------------------------
-- Generation run (pipeline state)
-- -----------------------------------------------------
create table if not exists public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  generation_request_id uuid
    references public.generation_requests(id) on delete set null,
  refinement_instruction_id uuid
    references public.refinement_instructions(id) on delete set null,
  run_number integer not null check (run_number > 0),
  run_source text not null
    check (run_source in ('initial', 'refine')),
  pipeline_state text not null default 'queued'
    check (pipeline_state in (
      'queued',
      'analyzing',
      'planning',
      'generating',
      'refining',
      'completed',
      'partially_completed',
      'failed',
      'blocked',
      'refunded'
    )),
  requested_image_count integer not null
    check (requested_image_count between 1 and 4),
  correlation_id uuid not null,
  attempt_count integer not null default 1
    check (attempt_count >= 1),
  retry_count integer not null default 0
    check (retry_count >= 0),
  max_retry_count integer not null default 3
    check (max_retry_count >= 0),
  next_retry_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  terminal_reason_code text,
  terminal_reason_message text,
  refund_amount integer not null default 0
    check (refund_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generation_runs_retry_count_lte_max
    check (retry_count <= max_retry_count),
  constraint generation_runs_source_reference_consistency
    check (
      (run_source = 'initial' and generation_request_id is not null and refinement_instruction_id is null)
      or
      (run_source = 'refine' and refinement_instruction_id is not null)
    )
);

create trigger trg_generation_runs_set_updated_at
before update on public.generation_runs
for each row execute function public.set_updated_at();

alter table public.generations
  add constraint fk_generations_active_run
  foreign key (active_run_id)
  references public.generation_runs(id)
  on delete set null;

-- based_on_run_id FK, generation_runs tablosu oluştuktan sonra eklenir
alter table public.refinement_instructions
  add constraint fk_refinement_instructions_based_on_run
  foreign key (based_on_run_id)
  references public.generation_runs(id)
  on delete set null;

-- -----------------------------------------------------
-- Image variants
-- -----------------------------------------------------
create table if not exists public.image_variants (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  run_id uuid not null
    references public.generation_runs(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  variant_index integer not null
    check (variant_index between 1 and 4),
  direction_index integer
    check (direction_index is null or direction_index > 0),
  status text not null default 'completed'
    check (status in ('completed', 'blocked', 'failed')),
  storage_bucket text not null default 'generated-images',
  storage_path text not null,
  mime_type text not null default 'image/png',
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  moderation_decision text not null default 'allow'
    check (moderation_decision in ('allow', 'sanitize', 'soft_block', 'hard_block', 'review')),
  moderation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint image_variants_run_variant_unique unique (run_id, variant_index)
);

create trigger trg_image_variants_set_updated_at
before update on public.image_variants
for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- Intent / analysis / direction / plan
-- -----------------------------------------------------
create table if not exists public.user_intents (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  run_id uuid not null unique
    references public.generation_runs(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  intent_json jsonb not null,
  model_name text,
  confidence numeric(5,4)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now()
);

create table if not exists public.emotion_analyses (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  run_id uuid not null unique
    references public.generation_runs(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  analysis_json jsonb not null,
  model_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.creative_directions (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  run_id uuid not null
    references public.generation_runs(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  direction_index integer not null check (direction_index > 0),
  direction_title text,
  direction_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint creative_directions_run_direction_unique unique (run_id, direction_index)
);

create table if not exists public.visual_plans (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  run_id uuid not null unique
    references public.generation_runs(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  selected_creative_direction_id uuid
    references public.creative_directions(id) on delete set null,
  plan_json jsonb not null,
  explainability_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visual_plans_explainability_json_is_object
    check (jsonb_typeof(explainability_json) = 'object')
);

create trigger trg_visual_plans_set_updated_at
before update on public.visual_plans
for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- Provider payloads (redacted)
-- -----------------------------------------------------
create table if not exists public.provider_payloads (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  run_id uuid not null
    references public.generation_runs(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  provider_type text not null
    check (provider_type in ('emotion_analysis', 'image_generation', 'safety_shaping')),
  provider_name text not null,
  request_payload_redacted jsonb not null,
  response_payload_redacted jsonb,
  status_code integer,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------
-- Moderation events
-- -----------------------------------------------------
create table if not exists public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  run_id uuid
    references public.generation_runs(id) on delete cascade,
  image_variant_id uuid
    references public.image_variants(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  stage text not null
    check (stage in ('input_moderation', 'pre_generation_shaping', 'output_moderation')),
  decision text not null
    check (decision in ('allow', 'sanitize', 'soft_block', 'hard_block', 'review')),
  policy_code text,
  message text,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint moderation_events_output_stage_requires_variant
    check (stage <> 'output_moderation' or image_variant_id is not null),
  constraint moderation_events_details_json_is_object
    check (jsonb_typeof(details_json) = 'object')
);

-- -----------------------------------------------------
-- Billing
-- -----------------------------------------------------
create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique
    references public.profiles(user_id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_billing_customers_set_updated_at
before update on public.billing_customers
for each row execute function public.set_updated_at();

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  billing_customer_id uuid
    references public.billing_customers(id) on delete set null,
  user_id uuid
    references public.profiles(user_id) on delete set null,
  stripe_event_id text not null,
  event_type text not null,
  event_state text not null
    check (event_state in ('received', 'validated', 'applying', 'completed', 'failed', 'refunded', 'ignored_duplicate')),
  payload_redacted jsonb not null default '{}'::jsonb,
  retry_count integer not null default 0 check (retry_count >= 0),
  max_retry_count integer not null default 5 check (max_retry_count >= 0),
  next_retry_at timestamptz,
  processed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_events_retry_count_lte_max
    check (retry_count <= max_retry_count),
  constraint billing_events_payload_redacted_is_object
    check (jsonb_typeof(payload_redacted) = 'object')
);

create trigger trg_billing_events_set_updated_at
before update on public.billing_events
for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- Jobs (teknik queue state)
-- -----------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique
    references public.generation_runs(id) on delete cascade,
  queue_state text not null default 'queued'
    check (queue_state in ('queued', 'leased', 'running', 'retry_wait', 'completed', 'failed', 'cancelled', 'dead_letter')),
  correlation_id uuid not null,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  max_retry_count integer not null default 3 check (max_retry_count >= 0),
  next_retry_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  dead_lettered_at timestamptz,
  last_error_code text,
  last_error_message text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_retry_count_lte_max
    check (retry_count <= max_retry_count),
  constraint jobs_payload_json_is_object
    check (jsonb_typeof(payload_json) = 'object')
);

create trigger trg_jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

-- -----------------------------------------------------
-- Favorites
-- -----------------------------------------------------
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  image_variant_id uuid not null
    references public.image_variants(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_user_variant_unique unique (user_id, image_variant_id)
);

-- -----------------------------------------------------
-- Credit ledger (append-only)
-- -----------------------------------------------------
create table if not exists public.credit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  credit_account_id uuid not null
    references public.credit_accounts(id) on delete restrict,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  entry_type text not null
    check (entry_type in ('debit', 'refund', 'purchase', 'adjustment')),
  reason text not null
    check (reason in (
      'generation_run_debit',
      'generation_run_refund_full',
      'generation_run_refund_prorata',
      'billing_purchase',
      'billing_refund',
      'admin_adjustment',
      'seed_grant'
    )),
  amount integer not null,
  generation_run_id uuid
    references public.generation_runs(id) on delete restrict,
  billing_event_id uuid
    references public.billing_events(id) on delete restrict,
  manual_reference text,
  idempotency_key text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint credit_ledger_entries_amount_sign
    check (
      (entry_type = 'debit' and amount < 0)
      or (entry_type in ('refund', 'purchase') and amount > 0)
      or (entry_type = 'adjustment' and amount <> 0)
    ),
  constraint credit_ledger_entries_reason_reference_consistency
    check (
      (
        reason in ('generation_run_debit', 'generation_run_refund_full', 'generation_run_refund_prorata')
        and generation_run_id is not null
      )
      or
      (
        reason in ('billing_purchase', 'billing_refund')
        and billing_event_id is not null
      )
      or
      (
        reason in ('admin_adjustment', 'seed_grant')
        and manual_reference is not null
      )
    ),
  constraint credit_ledger_entries_metadata_json_is_object
    check (jsonb_typeof(metadata_json) = 'object')
);

create trigger trg_credit_ledger_entries_no_update
before update on public.credit_ledger_entries
for each row execute function public.prevent_credit_ledger_mutation();

create trigger trg_credit_ledger_entries_no_delete
before delete on public.credit_ledger_entries
for each row execute function public.prevent_credit_ledger_mutation();

commit;
