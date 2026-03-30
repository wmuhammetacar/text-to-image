-- PHASE 7 / Migration 0008
-- Remix lineage + creator graph + social proof

begin;

alter table public.profiles
  add column if not exists profile_handle text;

alter table public.profiles
  alter column profile_handle set default lower('creator_' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10));

update public.profiles
set profile_handle = lower('creator_' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10))
where profile_handle is null;

alter table public.profiles
  alter column profile_handle set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_profile_handle_format'
  ) then
    alter table public.profiles
      add constraint profiles_profile_handle_format
      check (profile_handle ~ '^[a-z0-9_]{3,40}$');
  end if;
end
$$;

create unique index if not exists ux_profiles_profile_handle
  on public.profiles (profile_handle);

alter table public.variation_requests
  add column if not exists remix_depth integer not null default 0
    check (remix_depth >= 0),
  add column if not exists root_public_generation_id uuid
    references public.generations(id) on delete set null,
  add column if not exists root_creator_id uuid
    references public.profiles(user_id) on delete set null;

create index if not exists ix_variation_requests_root_public_generation
  on public.variation_requests (root_public_generation_id, created_at desc)
  where root_public_generation_id is not null;

create index if not exists ix_variation_requests_root_creator
  on public.variation_requests (root_creator_id, created_at desc)
  where root_creator_id is not null;

drop view if exists public.v_public_gallery;

create or replace view public.v_public_gallery as
with generation_base as (
  select
    g.id as generation_id,
    g.user_id,
    g.visibility,
    g.share_slug,
    g.published_at,
    g.featured_variant_id,
    p.display_name as creator_display_name,
    p.profile_handle as creator_profile_handle
  from public.generations g
  join public.profiles p
    on p.user_id = g.user_id
  where g.visibility = 'public'
    and g.published_at is not null
),
latest_visual_plan as (
  select
    vp.generation_id,
    vp.selected_creative_direction_id,
    vp.plan_json,
    vp.explainability_json,
    row_number() over (
      partition by vp.generation_id
      order by vp.updated_at desc, vp.created_at desc
    ) as rn
  from public.visual_plans vp
),
selected_direction as (
  select
    cd.generation_id,
    cd.id as creative_direction_id,
    cd.direction_json
  from public.creative_directions cd
),
featured_variant as (
  select
    iv.generation_id,
    iv.id,
    iv.storage_path,
    row_number() over (
      partition by iv.generation_id
      order by iv.created_at desc, iv.variant_index desc
    ) as rn
  from public.image_variants iv
  where iv.status = 'completed'
)
select
  gb.generation_id,
  gb.user_id,
  gb.visibility,
  gb.share_slug,
  gb.published_at,
  gb.creator_display_name,
  gb.creator_profile_handle,
  coalesce(
    lvp.explainability_json ->> 'summary',
    lvp.plan_json ->> 'summary',
    'Pixora generation'
  ) as summary,
  coalesce(
    case
      when jsonb_typeof(sd.direction_json -> 'styleTags') = 'array'
        then array(select jsonb_array_elements_text(sd.direction_json -> 'styleTags'))
      else '{}'::text[]
    end,
    '{}'::text[]
  ) as style_tags,
  array_remove(
    array[
      sd.direction_json -> 'colorPalette' ->> 'mood',
      lvp.plan_json -> 'colorStrategy' ->> 'mood'
    ],
    null
  ) as mood_tags,
  coalesce(fv_featured.storage_path, fv_latest.storage_path) as featured_image_path,
  (
    select count(*)::integer
    from public.generation_runs gr
    where gr.generation_id = gb.generation_id
  ) as total_runs,
  (
    select count(*)::integer
    from public.image_variants iv
    where iv.generation_id = gb.generation_id
      and iv.parent_variant_id is not null
  ) as variation_count,
  (
    select greatest(count(*)::integer - 1, 0)
    from public.generation_runs gr
    where gr.generation_id = gb.generation_id
  ) as refinement_count,
  (
    select count(distinct vr.generation_id)::integer
    from public.variation_requests vr
    join public.generations g_child
      on g_child.id = vr.generation_id
    where vr.remix_source_generation_id = gb.generation_id
      and g_child.visibility in ('public', 'unlisted')
  ) as remix_count,
  (
    select count(distinct vr.generation_id)::integer
    from public.variation_requests vr
    join public.generations g_child
      on g_child.id = vr.generation_id
    where vr.root_public_generation_id = gb.generation_id
      and g_child.visibility in ('public', 'unlisted')
  ) as branch_count,
  (
    select count(*)::integer
    from public.image_variants iv
    where iv.generation_id = gb.generation_id
      and iv.status = 'completed'
  ) as total_public_variants,
  count(*) over (partition by gb.user_id)::integer as creator_public_generation_count
from generation_base gb
left join latest_visual_plan lvp
  on lvp.generation_id = gb.generation_id
  and lvp.rn = 1
left join selected_direction sd
  on sd.creative_direction_id = lvp.selected_creative_direction_id
left join public.image_variants fv_featured
  on fv_featured.id = gb.featured_variant_id
  and fv_featured.status = 'completed'
left join featured_variant fv_latest
  on fv_latest.generation_id = gb.generation_id
  and fv_latest.rn = 1;

commit;
