-- PHASE 6 / Migration 0007
-- Identity + Share loop + Public gallery

begin;

create or replace function public.generate_share_slug()
returns text
language sql
as $$
  select lower(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16));
$$;

alter table public.generations
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'unlisted', 'public')),
  add column if not exists share_slug text not null default public.generate_share_slug(),
  add column if not exists published_at timestamptz,
  add column if not exists featured_variant_id uuid
    references public.image_variants(id) on delete set null;

create unique index if not exists ux_generations_share_slug
  on public.generations (share_slug);

create index if not exists ix_generations_public_published
  on public.generations (visibility, published_at desc)
  where visibility in ('public', 'unlisted');

create index if not exists ix_generations_featured_variant
  on public.generations (featured_variant_id)
  where featured_variant_id is not null;

alter table public.variation_requests
  add column if not exists remix_source_type text
    check (remix_source_type in ('public_generation')),
  add column if not exists remix_source_generation_id uuid
    references public.generations(id) on delete set null,
  add column if not exists remix_source_variant_id uuid
    references public.image_variants(id) on delete set null;

create index if not exists ix_variation_requests_remix_source_generation
  on public.variation_requests (remix_source_generation_id, created_at desc)
  where remix_source_generation_id is not null;

create or replace view public.v_public_gallery as
with generation_base as (
  select
    g.id as generation_id,
    g.user_id,
    g.visibility,
    g.share_slug,
    g.published_at,
    g.featured_variant_id,
    p.display_name as creator_display_name
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
  ) as refinement_count
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
