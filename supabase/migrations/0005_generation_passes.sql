-- ADIM 9 / Migration 0005
-- Multi-pass generation desteği

begin;

create table if not exists public.generation_passes (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.generations(id) on delete cascade,
  run_id uuid not null
    references public.generation_runs(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  pass_type text not null
    check (pass_type in ('concept', 'composition', 'detail', 'enhancement')),
  pass_index integer not null
    check (pass_index between 1 and 4),
  status text not null
    check (status in ('queued', 'running', 'completed', 'failed')),
  input_artifact_paths text[] not null default '{}',
  output_artifact_paths text[] not null default '{}',
  summary text,
  metadata_json jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generation_passes_run_type_unique unique (run_id, pass_type),
  constraint generation_passes_run_index_unique unique (run_id, pass_index),
  constraint generation_passes_metadata_json_is_object
    check (jsonb_typeof(metadata_json) = 'object')
);

create trigger trg_generation_passes_set_updated_at
before update on public.generation_passes
for each row execute function public.set_updated_at();

create index if not exists ix_generation_passes_run_index
  on public.generation_passes (run_id, pass_index asc);

create index if not exists ix_generation_passes_user_created
  on public.generation_passes (user_id, created_at desc);

alter table public.generation_passes enable row level security;

create policy generation_passes_select_own
  on public.generation_passes
  for select
  to authenticated
  using (user_id = auth.uid());

commit;
