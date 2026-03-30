import { RateLimitedAppError, type Logger } from "@vi/application";
import { createHash } from "node:crypto";
import { Pool } from "pg";

interface WindowBucket {
  count: number;
  resetAtMs: number;
}

export interface RateLimitRule {
  scope: string;
  reason: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitInput {
  key: string;
  requestId: string;
  logger: Logger;
  rule: RateLimitRule;
  context?: Record<string, unknown>;
  nowMs?: number;
  backend?: "memory" | "postgres";
  databaseUrl?: string;
}

class InMemoryFixedWindowRateLimiter {
  private readonly buckets = new Map<string, WindowBucket>();
  private lastPruneMs = 0;

  public consume(key: string, limit: number, windowMs: number, nowMs: number): {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
    resetAtMs: number;
  } {
    this.prune(nowMs);
    const existing = this.buckets.get(key);

    if (existing === undefined || existing.resetAtMs <= nowMs) {
      const next: WindowBucket = {
        count: 1,
        resetAtMs: nowMs + windowMs,
      };
      this.buckets.set(key, next);
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfterSeconds: Math.ceil(windowMs / 1000),
        resetAtMs: next.resetAtMs,
      };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)),
        resetAtMs: existing.resetAtMs,
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - existing.count),
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)),
      resetAtMs: existing.resetAtMs,
    };
  }

  public resetForTests(): void {
    this.buckets.clear();
    this.lastPruneMs = 0;
  }

  private prune(nowMs: number): void {
    if (nowMs - this.lastPruneMs < 5_000) {
      return;
    }
    this.lastPruneMs = nowMs;
    for (const [key, value] of this.buckets) {
      if (value.resetAtMs <= nowMs) {
        this.buckets.delete(key);
      }
    }
  }
}

const limiterSingleton = new InMemoryFixedWindowRateLimiter();
const poolsByConnection = new Map<string, Pool>();
const ensuredTableByConnection = new Set<string>();
let poolSeedCounter = 0;

function normalizedKey(input: string): string {
  return input.trim().toLowerCase();
}

function getPostgresPool(databaseUrl: string): Pool {
  const existing = poolsByConnection.get(databaseUrl);
  if (existing !== undefined) {
    return existing;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    application_name: `vi_rate_limiter_${++poolSeedCounter}`,
  });
  poolsByConnection.set(databaseUrl, pool);
  return pool;
}

async function ensureRateLimitTable(databaseUrl: string): Promise<void> {
  if (ensuredTableByConnection.has(databaseUrl)) {
    return;
  }

  const pool = getPostgresPool(databaseUrl);
  await pool.query(`
    create table if not exists public.rate_limit_counters (
      scope text not null,
      key_hash text not null,
      window_start timestamptz not null,
      hit_count integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key (scope, key_hash, window_start)
    )
  `);
  await pool.query(`
    create index if not exists idx_rate_limit_counters_updated_at
      on public.rate_limit_counters (updated_at)
  `);
  ensuredTableByConnection.add(databaseUrl);
}

async function consumePostgres(
  params: {
    scope: string;
    key: string;
    limit: number;
    windowMs: number;
    nowMs: number;
    databaseUrl: string;
  },
): Promise<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAtMs: number;
}> {
  const normalized = normalizedKey(params.key);
  const keyHash = createHash("sha256").update(normalized).digest("hex");
  const windowStartMs = Math.floor(params.nowMs / params.windowMs) * params.windowMs;
  const resetAtMs = windowStartMs + params.windowMs;
  const windowStart = new Date(windowStartMs);

  await ensureRateLimitTable(params.databaseUrl);
  const pool = getPostgresPool(params.databaseUrl);
  const result = await pool.query<{ hit_count: number }>(
    `
    insert into public.rate_limit_counters (scope, key_hash, window_start, hit_count, updated_at)
    values ($1, $2, $3, 1, now())
    on conflict (scope, key_hash, window_start)
    do update
      set hit_count = public.rate_limit_counters.hit_count + 1,
          updated_at = now()
    returning hit_count
    `,
    [params.scope, keyHash, windowStart],
  );

  const hitCount = result.rows[0]?.hit_count ?? 1;
  const allowed = hitCount <= params.limit;
  const remaining = allowed ? Math.max(0, params.limit - hitCount) : 0;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - params.nowMs) / 1000));

  if (Math.random() < 0.01) {
    void pool.query(
      `
      delete from public.rate_limit_counters
      where updated_at < now() - interval '2 hours'
      `,
    );
  }

  return {
    allowed,
    remaining,
    retryAfterSeconds,
    resetAtMs,
  };
}

export async function enforceRateLimit(input: RateLimitInput): Promise<void> {
  const nowMs = input.nowMs ?? Date.now();
  const key = `${input.rule.scope}:${normalizedKey(input.key)}`;
  const backend = input.backend ?? "memory";
  const consumed =
    backend === "postgres" && input.databaseUrl !== undefined && input.databaseUrl.length > 0
      ? await consumePostgres({
        scope: input.rule.scope,
        key: input.key,
        limit: input.rule.limit,
        windowMs: input.rule.windowMs,
        nowMs,
        databaseUrl: input.databaseUrl,
      })
      : limiterSingleton.consume(
        key,
        input.rule.limit,
        input.rule.windowMs,
        nowMs,
      );

  if (consumed.allowed) {
    return;
  }

  input.logger.warn("rate_limit_blocked", {
    requestId: input.requestId,
    scope: input.rule.scope,
    reason: input.rule.reason,
    key,
    retryAfterSeconds: consumed.retryAfterSeconds,
    ...(input.context ?? {}),
  });

  throw new RateLimitedAppError({
    message: "Çok fazla istek gönderildi. Lütfen kısa süre sonra tekrar deneyin.",
    retryAfterSeconds: consumed.retryAfterSeconds,
    scope: input.rule.scope,
    reason: input.rule.reason,
  });
}

export function resetRateLimiterForTests(): void {
  limiterSingleton.resetForTests();
  ensuredTableByConnection.clear();
  for (const pool of poolsByConnection.values()) {
    void pool.end();
  }
  poolsByConnection.clear();
}
