import type {
  BillingEventState,
  GenerationPassStatus,
  GenerationRunPipelineState,
  GenerationState,
  JobQueueState,
} from "./states";

const runTransitionMap: Readonly<Record<GenerationRunPipelineState, GenerationRunPipelineState[]>> = {
  queued: ["analyzing", "refining"],
  refining: ["analyzing"],
  analyzing: ["planning", "failed", "queued"],
  planning: ["generating", "failed", "blocked", "queued"],
  generating: ["completed", "partially_completed", "failed", "blocked", "queued"],
  completed: [],
  partially_completed: ["refunded"],
  failed: ["refunded"],
  blocked: ["refunded"],
  refunded: [],
};

const jobTransitionMap: Readonly<Record<JobQueueState, JobQueueState[]>> = {
  queued: ["leased", "cancelled"],
  leased: ["running", "queued"],
  running: ["completed", "retry_wait", "failed"],
  retry_wait: ["queued"],
  completed: [],
  failed: ["dead_letter"],
  cancelled: [],
  dead_letter: [],
};

const billingTransitionMap: Readonly<Record<BillingEventState, BillingEventState[]>> = {
  received: ["validated", "ignored_duplicate", "failed"],
  validated: ["applying", "completed", "failed"],
  applying: ["completed", "refunded", "failed"],
  completed: [],
  failed: [],
  refunded: [],
  ignored_duplicate: [],
};

const passTransitionMap: Readonly<Record<GenerationPassStatus, GenerationPassStatus[]>> = {
  queued: ["running"],
  running: ["completed", "failed"],
  completed: [],
  failed: [],
};

export function canTransitionRun(
  from: GenerationRunPipelineState,
  to: GenerationRunPipelineState,
): boolean {
  return runTransitionMap[from].includes(to);
}

export function canTransitionJob(from: JobQueueState, to: JobQueueState): boolean {
  return jobTransitionMap[from].includes(to);
}

export function canTransitionBillingEvent(from: BillingEventState, to: BillingEventState): boolean {
  return billingTransitionMap[from].includes(to);
}

export function canTransitionGenerationPass(
  from: GenerationPassStatus,
  to: GenerationPassStatus,
): boolean {
  return passTransitionMap[from].includes(to);
}

export function deriveGenerationStateFromRun(
  runState: GenerationRunPipelineState,
  previousState: GenerationState,
): GenerationState {
  if (["queued", "analyzing", "planning", "generating", "refining"].includes(runState)) {
    return "active";
  }
  if (runState === "completed") {
    return "completed";
  }
  if (runState === "partially_completed") {
    return "partially_completed";
  }
  if (runState === "failed") {
    return "failed";
  }
  if (runState === "blocked") {
    return "blocked";
  }
  return previousState;
}

export function isRunTerminal(state: GenerationRunPipelineState): boolean {
  return ["completed", "partially_completed", "failed", "blocked", "refunded"].includes(state);
}

export function isJobTerminal(state: JobQueueState): boolean {
  return ["completed", "cancelled", "dead_letter"].includes(state);
}

export function isBillingEventTerminal(state: BillingEventState): boolean {
  return ["completed", "failed", "refunded", "ignored_duplicate"].includes(state);
}
