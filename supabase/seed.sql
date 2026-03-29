-- ADIM 2 / Minimal geliştirme seed verisi
-- Kapsam: Sadece database bootstrap

begin;

-- -----------------------------------------------------
-- Sabit kimlikler
-- -----------------------------------------------------
-- user_id:     00000000-0000-0000-0000-000000000001
-- profile_id:  10000000-0000-0000-0000-000000000001
-- account_id:  20000000-0000-0000-0000-000000000001
-- generation:  30000000-0000-0000-0000-000000000001
-- gen_req:     31000000-0000-0000-0000-000000000001
-- run_id:      32000000-0000-0000-0000-000000000001
-- variant_1:   33000000-0000-0000-0000-000000000001
-- variant_2:   33000000-0000-0000-0000-000000000002
-- favorite:    34000000-0000-0000-0000-000000000001
-- moderation:  35000000-0000-0000-0000-000000000001
-- billing_cus: 36000000-0000-0000-0000-000000000001
-- job_id:      37000000-0000-0000-0000-000000000001
-- ledger_1:    38000000-0000-0000-0000-000000000001
-- ledger_2:    38000000-0000-0000-0000-000000000002
-- corr_id:     42000000-0000-0000-0000-000000000001

insert into public.profiles (
  id,
  user_id,
  email,
  display_name,
  segment
) values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'seed-user@example.com',
  'Seed User',
  'b2c'
)
on conflict (id) do nothing;

insert into public.credit_accounts (
  id,
  user_id,
  balance,
  pending_refund
) values (
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  18,
  0
)
on conflict (id) do nothing;

insert into public.generations (
  id,
  user_id,
  state,
  refund_state,
  active_run_id
) values (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'completed',
  'none',
  null
)
on conflict (id) do nothing;

insert into public.generation_requests (
  id,
  generation_id,
  user_id,
  source_text,
  requested_image_count,
  creative_mode,
  controls_json,
  idempotency_key
) values (
  '31000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Yağmur sonrası sakin bir şehir hissi',
  2,
  'balanced',
  '{"cinematic": 1, "calmness": 2}'::jsonb,
  'seed-generation-request-1'
)
on conflict (id) do nothing;

insert into public.generation_runs (
  id,
  generation_id,
  user_id,
  generation_request_id,
  refinement_instruction_id,
  run_number,
  run_source,
  pipeline_state,
  requested_image_count,
  correlation_id,
  attempt_count,
  retry_count,
  max_retry_count,
  started_at,
  completed_at
) values (
  '32000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  null,
  1,
  'initial',
  'completed',
  2,
  '42000000-0000-0000-0000-000000000001',
  1,
  0,
  3,
  now() - interval '3 minutes',
  now() - interval '2 minutes'
)
on conflict (id) do nothing;

update public.generations
set active_run_id = '32000000-0000-0000-0000-000000000001',
    updated_at = now()
where id = '30000000-0000-0000-0000-000000000001';

insert into public.image_variants (
  id,
  generation_id,
  run_id,
  user_id,
  variant_index,
  direction_index,
  status,
  storage_bucket,
  storage_path,
  mime_type,
  width,
  height,
  moderation_decision
) values
(
  '33000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  1,
  1,
  'completed',
  'generated-images',
  'dev/00000000-0000-0000-0000-000000000001/32000000-0000-0000-0000-000000000001/variant-1.png',
  'image/png',
  1024,
  1024,
  'allow'
),
(
  '33000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  2,
  2,
  'completed',
  'generated-images',
  'dev/00000000-0000-0000-0000-000000000001/32000000-0000-0000-0000-000000000001/variant-2.png',
  'image/png',
  1024,
  1024,
  'allow'
)
on conflict (id) do nothing;

insert into public.favorites (
  id,
  user_id,
  image_variant_id
) values (
  '34000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.moderation_events (
  id,
  generation_id,
  run_id,
  image_variant_id,
  user_id,
  stage,
  decision,
  policy_code,
  message,
  details_json
) values (
  '35000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'output_moderation',
  'allow',
  'SAFE_OUTPUT',
  'Çıktı moderasyondan geçti.',
  '{"model":"seed-moderator-v1"}'::jsonb
)
on conflict (id) do nothing;

insert into public.billing_customers (
  id,
  user_id,
  stripe_customer_id
) values (
  '36000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'cus_seed_001'
)
on conflict (id) do nothing;

insert into public.jobs (
  id,
  run_id,
  queue_state,
  correlation_id,
  leased_at,
  lease_expires_at,
  retry_count,
  max_retry_count,
  completed_at,
  payload_json
) values (
  '37000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  'completed',
  '42000000-0000-0000-0000-000000000001',
  now() - interval '3 minutes',
  now() - interval '2 minutes 30 seconds',
  0,
  3,
  now() - interval '2 minutes',
  '{"seed":true}'::jsonb
)
on conflict (id) do nothing;

insert into public.credit_ledger_entries (
  id,
  credit_account_id,
  user_id,
  entry_type,
  reason,
  amount,
  generation_run_id,
  billing_event_id,
  manual_reference,
  idempotency_key,
  metadata_json
) values
(
  '38000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'purchase',
  'seed_grant',
  20,
  null,
  null,
  'seed/init',
  'seed-ledger-grant-1',
  '{"note":"development seed grant"}'::jsonb
),
(
  '38000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'debit',
  'generation_run_debit',
  -2,
  '32000000-0000-0000-0000-000000000001',
  null,
  null,
  'seed-ledger-debit-run-1',
  '{"variant_count":2}'::jsonb
)
on conflict (id) do nothing;

commit;
