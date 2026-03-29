-- ADIM 2 / Migration 0003
-- RLS politikaları

begin;

-- -----------------------------------------------------
-- Supabase disi local ortam fallback'leri
-- -----------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- -----------------------------------------------------
-- RLS enable
-- -----------------------------------------------------
alter table public.profiles enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger_entries enable row level security;
alter table public.generations enable row level security;
alter table public.generation_requests enable row level security;
alter table public.generation_runs enable row level security;
alter table public.image_variants enable row level security;
alter table public.refinement_instructions enable row level security;
alter table public.user_intents enable row level security;
alter table public.emotion_analyses enable row level security;
alter table public.creative_directions enable row level security;
alter table public.visual_plans enable row level security;
alter table public.provider_payloads enable row level security;
alter table public.moderation_events enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_events enable row level security;
alter table public.jobs enable row level security;
alter table public.favorites enable row level security;

-- -----------------------------------------------------
-- profiles: kullanıcı kendi profilini okuyup güncelleyebilir
-- -----------------------------------------------------
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (user_id = auth.uid());

create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------
-- favorites: kullanıcı kendi favorisini yönetebilir
-- -----------------------------------------------------
create policy favorites_select_own
  on public.favorites
  for select
  to authenticated
  using (user_id = auth.uid());

create policy favorites_insert_own
  on public.favorites
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.image_variants iv
      where iv.id = image_variant_id
        and iv.user_id = auth.uid()
    )
  );

create policy favorites_delete_own
  on public.favorites
  for delete
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------
-- Salt-okuma: kullanıcı sadece kendi verisini görür
-- -----------------------------------------------------
create policy credit_accounts_select_own
  on public.credit_accounts
  for select
  to authenticated
  using (user_id = auth.uid());

create policy credit_ledger_entries_select_own
  on public.credit_ledger_entries
  for select
  to authenticated
  using (user_id = auth.uid());

create policy generations_select_own
  on public.generations
  for select
  to authenticated
  using (user_id = auth.uid());

create policy generation_requests_select_own
  on public.generation_requests
  for select
  to authenticated
  using (user_id = auth.uid());

create policy generation_runs_select_own
  on public.generation_runs
  for select
  to authenticated
  using (user_id = auth.uid());

create policy image_variants_select_own
  on public.image_variants
  for select
  to authenticated
  using (user_id = auth.uid());

create policy refinement_instructions_select_own
  on public.refinement_instructions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy user_intents_select_own
  on public.user_intents
  for select
  to authenticated
  using (user_id = auth.uid());

create policy emotion_analyses_select_own
  on public.emotion_analyses
  for select
  to authenticated
  using (user_id = auth.uid());

create policy creative_directions_select_own
  on public.creative_directions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy visual_plans_select_own
  on public.visual_plans
  for select
  to authenticated
  using (user_id = auth.uid());

create policy provider_payloads_select_own
  on public.provider_payloads
  for select
  to authenticated
  using (user_id = auth.uid());

create policy moderation_events_select_own
  on public.moderation_events
  for select
  to authenticated
  using (user_id = auth.uid());

create policy billing_customers_select_own
  on public.billing_customers
  for select
  to authenticated
  using (user_id = auth.uid());

create policy billing_events_select_own
  on public.billing_events
  for select
  to authenticated
  using (user_id = auth.uid());

-- jobs tablosunda authenticated kullanıcı için policy tanımlanmaz.
-- service_role bypassrls ile erişir.

commit;
