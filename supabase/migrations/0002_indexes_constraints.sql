-- ADIM 2 / Migration 0002
-- İndeksler, unique kısıtlar ve ek bütünlük kuralları

begin;

-- -----------------------------------------------------
-- Unique ve idempotency kısıtları
-- -----------------------------------------------------
create unique index if not exists ux_generation_requests_generation_id
  on public.generation_requests (generation_id);

create unique index if not exists ux_generation_requests_user_idempotency
  on public.generation_requests (user_id, idempotency_key);

create unique index if not exists ux_refinement_instructions_user_idempotency
  on public.refinement_instructions (user_id, idempotency_key);

create unique index if not exists ux_generation_runs_generation_run_number
  on public.generation_runs (generation_id, run_number);

create unique index if not exists ux_generation_runs_correlation_id
  on public.generation_runs (correlation_id);

create unique index if not exists ux_billing_events_stripe_event_id
  on public.billing_events (stripe_event_id);

create unique index if not exists ux_credit_ledger_entries_idempotency_key
  on public.credit_ledger_entries (idempotency_key);

-- -----------------------------------------------------
-- Kullanıcı bazlı sorgu indeksleri
-- -----------------------------------------------------
create index if not exists ix_profiles_user_id
  on public.profiles (user_id);

create index if not exists ix_credit_accounts_user_id
  on public.credit_accounts (user_id);

create index if not exists ix_generations_user_created
  on public.generations (user_id, created_at desc);

create index if not exists ix_generation_runs_user_created
  on public.generation_runs (user_id, created_at desc);

create index if not exists ix_image_variants_user_created
  on public.image_variants (user_id, created_at desc);

create index if not exists ix_favorites_user_created
  on public.favorites (user_id, created_at desc);

create index if not exists ix_credit_ledger_entries_user_created
  on public.credit_ledger_entries (user_id, created_at desc);

create index if not exists ix_moderation_events_user_created
  on public.moderation_events (user_id, created_at desc);

create index if not exists ix_billing_customers_user_id
  on public.billing_customers (user_id);

create index if not exists ix_billing_events_user_created
  on public.billing_events (user_id, created_at desc);

-- -----------------------------------------------------
-- Generation history ve active run lookup
-- -----------------------------------------------------
create index if not exists ix_generations_active_run_id
  on public.generations (active_run_id);

create index if not exists ix_generation_runs_generation_created
  on public.generation_runs (generation_id, created_at desc);

create index if not exists ix_generation_runs_generation_state_created
  on public.generation_runs (generation_id, pipeline_state, created_at desc);

create index if not exists ix_image_variants_run_created
  on public.image_variants (run_id, created_at desc);

create index if not exists ix_image_variants_generation_created
  on public.image_variants (generation_id, created_at desc);

-- -----------------------------------------------------
-- Job polling ve dead-letter indeksleri
-- -----------------------------------------------------
create index if not exists ix_jobs_queue_polling
  on public.jobs (queue_state, next_retry_at, leased_at, created_at)
  where queue_state in ('queued', 'retry_wait', 'leased');

create index if not exists ix_jobs_run_id
  on public.jobs (run_id);

create index if not exists ix_jobs_correlation_id
  on public.jobs (correlation_id);

create index if not exists ix_jobs_dead_letter
  on public.jobs (dead_lettered_at)
  where queue_state = 'dead_letter';

-- -----------------------------------------------------
-- Billing duplicate ve retry sorguları
-- -----------------------------------------------------
create index if not exists ix_billing_events_state_next_retry
  on public.billing_events (event_state, next_retry_at)
  where event_state in ('received', 'validated', 'applying', 'failed');

-- -----------------------------------------------------
-- Favorites lookup
-- -----------------------------------------------------
create index if not exists ix_favorites_image_variant_id
  on public.favorites (image_variant_id);

-- -----------------------------------------------------
-- Ledger sorgu indeksleri
-- -----------------------------------------------------
create index if not exists ix_credit_ledger_entries_account_created
  on public.credit_ledger_entries (credit_account_id, created_at desc);

create index if not exists ix_credit_ledger_entries_run_id
  on public.credit_ledger_entries (generation_run_id)
  where generation_run_id is not null;

create index if not exists ix_credit_ledger_entries_billing_event_id
  on public.credit_ledger_entries (billing_event_id)
  where billing_event_id is not null;

-- -----------------------------------------------------
-- Ek bütünlük kontrolleri
-- -----------------------------------------------------
alter table public.jobs
  add constraint jobs_lease_order_check
  check (lease_expires_at is null or leased_at is null or lease_expires_at >= leased_at);

alter table public.generation_runs
  add constraint generation_runs_terminal_time_check
  check (
    (pipeline_state in ('completed', 'partially_completed', 'failed', 'blocked', 'refunded') and completed_at is not null)
    or
    (pipeline_state in ('queued', 'analyzing', 'planning', 'generating', 'refining'))
  );

commit;

