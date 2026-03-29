-- ADIM 2 / Migration 0004
-- View ve projection katmanı

begin;

-- -----------------------------------------------------
-- Generation history projection
-- API alanlarını destekler:
-- generation_id, active_run_state, created_at,
-- latest_variant_thumbnail_path (URL değil path), total_runs
-- -----------------------------------------------------
create or replace view public.v_generation_history as
select
  g.id as generation_id,
  g.user_id,
  coalesce(gr.pipeline_state, 'queued') as active_run_state,
  g.created_at,
  (
    select iv.storage_path
    from public.image_variants iv
    where iv.generation_id = g.id
      and iv.status = 'completed'
    order by iv.created_at desc, iv.variant_index desc
    limit 1
  ) as latest_variant_thumbnail_path,
  (
    select count(*)::integer
    from public.generation_runs grc
    where grc.generation_id = g.id
  ) as total_runs
from public.generations g
left join public.generation_runs gr
  on gr.id = g.active_run_id;

-- -----------------------------------------------------
-- Credit account projection (ledger kaynak doğruluk)
-- -----------------------------------------------------
create or replace view public.v_credit_account_projection as
select
  ca.id as credit_account_id,
  ca.user_id,
  coalesce(sum(cle.amount), 0)::integer as computed_balance,
  coalesce(sum(
    case
      when cle.reason = 'generation_run_refund_prorata' then cle.amount
      else 0
    end
  ), 0)::integer as computed_prorata_refund_total,
  max(cle.created_at) as last_ledger_entry_at
from public.credit_accounts ca
left join public.credit_ledger_entries cle
  on cle.credit_account_id = ca.id
group by ca.id, ca.user_id;

-- -----------------------------------------------------
-- Job lease projection
-- -----------------------------------------------------
create or replace view public.v_jobs_ready_for_lease as
select
  j.id,
  j.run_id,
  j.queue_state,
  j.retry_count,
  j.max_retry_count,
  j.next_retry_at,
  j.leased_at,
  j.lease_expires_at,
  j.correlation_id,
  j.created_at
from public.jobs j
where j.queue_state in ('queued', 'retry_wait')
  and (j.next_retry_at is null or j.next_retry_at <= now())
  and (
    j.leased_at is null
    or j.lease_expires_at is null
    or j.lease_expires_at <= now()
  )
order by j.created_at asc;

commit;
