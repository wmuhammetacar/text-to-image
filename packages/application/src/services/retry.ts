const RETRY_BACKOFF_SECONDS = [10, 30, 90] as const;

export function nextRetryDelaySeconds(retryCount: number): number {
  const cappedIndex = Math.min(retryCount, RETRY_BACKOFF_SECONDS.length - 1);
  const fallback = RETRY_BACKOFF_SECONDS[RETRY_BACKOFF_SECONDS.length - 1]!;
  return RETRY_BACKOFF_SECONDS[cappedIndex] ?? fallback;
}
