import type { GenerationDetailResponseDto } from "@vi/contracts";

export const TERMINAL_RUN_STATES: ReadonlySet<GenerationDetailResponseDto["active_run_state"]> =
  new Set(["completed", "partially_completed", "failed", "blocked", "refunded"]);

export function isTerminalRunState(
  state: GenerationDetailResponseDto["active_run_state"],
): boolean {
  return TERMINAL_RUN_STATES.has(state);
}

export function getNextPollDelayMs(
  state: GenerationDetailResponseDto["active_run_state"],
  failureCount: number,
): number {
  if (isTerminalRunState(state)) {
    return 0;
  }

  if (failureCount <= 0) {
    return 1800;
  }

  if (failureCount === 1) {
    return 3000;
  }

  if (failureCount === 2) {
    return 5000;
  }

  return 8000;
}
