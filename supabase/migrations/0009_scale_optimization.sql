begin;

-- Distributed rate limit backend counter table
create table if not exists public.rate_limit_counters (
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  hit_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash, window_start)
);

create index if not exists idx_rate_limit_counters_updated_at
  on public.rate_limit_counters (updated_at);

create index if not exists idx_rate_limit_counters_scope_window
  on public.rate_limit_counters (scope, window_start desc);

-- Gallery ranking precompute preparation
create materialized view if not exists public.mv_public_gallery_ranking as
select
  g.generation_id,
  g.published_at,
  g.remix_count,
  g.branch_count,
  g.refinement_count,
  g.variation_count,
  g.total_public_variants,
  (
    (least(100, g.remix_count * 12 + g.branch_count * 6)) * 0.40 +
    (least(100, g.refinement_count * 4 + g.variation_count * 3)) * 0.20 +
    (least(100, g.total_public_variants * 3)) * 0.15 +
    (greatest(
      0,
      100 - floor(extract(epoch from (now() - g.published_at)) / 3600)
    )) * 0.25
  )::numeric(10,2) as ranking_score
from public.v_public_gallery g;

create unique index if not exists ux_mv_public_gallery_ranking_generation_id
  on public.mv_public_gallery_ranking (generation_id);

create index if not exists idx_mv_public_gallery_ranking_score
  on public.mv_public_gallery_ranking (ranking_score desc, published_at desc);

commit;

