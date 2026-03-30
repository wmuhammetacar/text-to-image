-- PHASE 3 / Migration 0006
-- Variation / upscale / edit loop veri modeli

begin;

alter table public.image_variants
  add column if not exists parent_variant_id uuid
    references public.image_variants(id) on delete set null,
  add column if not exists root_generation_id uuid
    references public.generations(id) on delete set null,
  add column if not exists variation_type text
    check (variation_type in (
      'more_dramatic',
      'more_minimal',
      'more_realistic',
      'more_stylized',
      'change_lighting',
      'change_environment',
      'change_mood',
      'increase_detail',
      'simplify_scene',
      'keep_subject_change_environment',
      'keep_composition_change_style',
      'keep_mood_change_realism',
      'keep_style_change_subject',
      'upscale'
    )),
  add column if not exists branch_depth integer not null default 0
    check (branch_depth >= 0),
  add column if not exists is_upscaled boolean not null default false;

create index if not exists ix_image_variants_parent_variant_id
  on public.image_variants (parent_variant_id)
  where parent_variant_id is not null;

create index if not exists ix_image_variants_root_generation_id
  on public.image_variants (root_generation_id)
  where root_generation_id is not null;

create table if not exists public.variation_requests (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  run_id uuid not null unique
    references public.generation_runs(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  base_variant_id uuid not null
    references public.image_variants(id) on delete restrict,
  variation_type text not null
    check (variation_type in (
      'more_dramatic',
      'more_minimal',
      'more_realistic',
      'more_stylized',
      'change_lighting',
      'change_environment',
      'change_mood',
      'increase_detail',
      'simplify_scene',
      'keep_subject_change_environment',
      'keep_composition_change_style',
      'keep_mood_change_realism',
      'keep_style_change_subject',
      'upscale'
    )),
  variation_parameters_json jsonb not null default '{}'::jsonb,
  requested_image_count integer not null check (requested_image_count between 1 and 4),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint variation_requests_parameters_is_object
    check (jsonb_typeof(variation_parameters_json) = 'object'),
  constraint variation_requests_user_idempotency_unique
    unique (user_id, idempotency_key)
);

create index if not exists ix_variation_requests_user_created
  on public.variation_requests (user_id, created_at desc);

create index if not exists ix_variation_requests_generation_created
  on public.variation_requests (generation_id, created_at desc);

create index if not exists ix_variation_requests_base_variant
  on public.variation_requests (base_variant_id, created_at desc);

alter table public.variation_requests enable row level security;

create policy variation_requests_select_own
  on public.variation_requests
  for select
  to authenticated
  using (user_id = auth.uid());

commit;
