import { randomUUID } from "node:crypto";
import type {
  CreateAnalysisArtifactsInput,
  CreateGenerationPassInput,
  CreateInitialRunTxInput,
  CreateInitialRunTxResult,
  CreateRefineRunTxInput,
  CreateRefineRunTxResult,
  CreateVariationRunTxInput,
  CreateVariationRunTxResult,
  GenerationHistoryPage,
  GenerationHistoryRow,
  PublicGalleryPage,
  PublicGenerationAggregate,
  Repository,
  RepositoryTx,
  RunDetailAggregate,
  RunExecutionContext,
  UserSegment,
} from "@vi/application";
import type {
  CreativeDirection,
  EmotionAnalysis,
  Generation,
  GenerationPass,
  GenerationRun,
  ImageVariant,
  Job,
  ModerationEvent,
  UserIntent,
  VariationType,
  VisualPlan,
} from "@vi/domain";
import { canTransitionGenerationPass, canTransitionJob, canTransitionRun } from "@vi/domain";

interface StoredGenerationRequest {
  id: string;
  generationId: string;
  userId: string;
  sourceText: string;
  requestedImageCount: number;
  creativeMode: "fast" | "balanced" | "directed";
  controlsJson: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: Date;
}

interface StoredRefinementInstruction {
  id: string;
  generationId: string;
  userId: string;
  basedOnRunId: string | null;
  instructionText: string;
  controlsDeltaJson: Record<string, unknown>;
  requestedImageCount: number;
  idempotencyKey: string;
  createdAt: Date;
}

interface StoredVariationRequest {
  id: string;
  generationId: string;
  runId: string;
  userId: string;
  baseVariantId: string;
  variationType: VariationType;
  variationParametersJson: Record<string, unknown>;
  remixSourceType: "public_generation" | null;
  remixSourceGenerationId: string | null;
  remixSourceVariantId: string | null;
  remixDepth: number;
  rootPublicGenerationId: string | null;
  rootCreatorId: string | null;
  requestedImageCount: number;
  idempotencyKey: string;
  createdAt: Date;
}

interface CreditLedgerEntry {
  id: string;
  userId: string;
  creditAccountId: string;
  entryType: "debit" | "refund";
  reason: string;
  amount: number;
  generationRunId: string | null;
  idempotencyKey: string;
  createdAt: Date;
}

interface CreditAccount {
  id: string;
  userId: string;
  balance: number;
}

interface ProviderPayload {
  id: string;
  generationId: string;
  runId: string;
  providerType: "emotion_analysis" | "image_generation" | "safety_shaping";
}

function encodeCursor(createdAt: Date, generationId: string): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), generationId }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; generationId: string } {
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
    createdAt: string;
    generationId: string;
  };

  return {
    createdAt: new Date(parsed.createdAt),
    generationId: parsed.generationId,
  };
}

function createShareSlug(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16).toLowerCase();
}

export class InMemoryRepository implements Repository, RepositoryTx {
  private readonly displayNameByUser = new Map<string, string>();
  private readonly profileHandleByUser = new Map<string, string>();
  private readonly segmentByUser = new Map<string, UserSegment>();
  private readonly generations = new Map<string, Generation>();
  private readonly generationRequests = new Map<string, StoredGenerationRequest>();
  private readonly generationRequestsByIdempotency = new Map<string, string>();
  private readonly refinementInstructions = new Map<string, StoredRefinementInstruction>();
  private readonly refinementByIdempotency = new Map<string, string>();
  private readonly variationRequests = new Map<string, StoredVariationRequest>();
  private readonly variationByIdempotency = new Map<string, string>();
  private readonly runs = new Map<string, GenerationRun>();
  private readonly jobs = new Map<string, Job>();
  private readonly jobsByRun = new Map<string, string>();
  private readonly variants = new Map<string, ImageVariant>();
  private readonly variantByRunIndex = new Map<string, string>();
  private readonly moderationEvents = new Map<string, ModerationEvent>();
  private readonly userIntentsByRun = new Map<string, UserIntent>();
  private readonly emotionAnalysesByRun = new Map<string, EmotionAnalysis>();
  private readonly creativeDirectionsByRun = new Map<string, CreativeDirection[]>();
  private readonly visualPlansByRun = new Map<string, VisualPlan>();
  private readonly generationPassesByRun = new Map<string, GenerationPass[]>();
  private readonly creditAccounts = new Map<string, CreditAccount>();
  private readonly creditAccountsByUser = new Map<string, string>();
  private readonly ledger: CreditLedgerEntry[] = [];
  private readonly ledgerByIdempotency = new Set<string>();
  private readonly providerPayloads: ProviderPayload[] = [];

  public readonly runTransitions: Array<{
    runId: string;
    from: GenerationRun["pipelineState"];
    to: GenerationRun["pipelineState"];
  }> = [];

  public seedUser(
    userId: string,
    balance = 100,
    segment: UserSegment = "b2c",
  ): void {
    const accountId = randomUUID();
    this.creditAccounts.set(accountId, {
      id: accountId,
      userId,
      balance,
    });
    this.creditAccountsByUser.set(userId, accountId);
    if (!this.displayNameByUser.has(userId)) {
      this.displayNameByUser.set(userId, `Creator-${userId.slice(0, 6)}`);
    }
    if (!this.profileHandleByUser.has(userId)) {
      this.profileHandleByUser.set(userId, `creator_${userId.slice(0, 8).toLowerCase()}`);
    }
    this.segmentByUser.set(userId, segment);
  }

  public getRun(runId: string): GenerationRun | null {
    return this.runs.get(runId) ?? null;
  }

  public getGeneration(generationId: string): Generation | null {
    return this.generations.get(generationId) ?? null;
  }

  public getRunsByGeneration(generationId: string): GenerationRun[] {
    return [...this.runs.values()].filter((run) => run.generationId === generationId);
  }

  public getJobByRun(runId: string): Job | null {
    const jobId = this.jobsByRun.get(runId);
    if (jobId === undefined) {
      return null;
    }
    return this.jobs.get(jobId) ?? null;
  }

  public getRefundEntriesByRun(runId: string): CreditLedgerEntry[] {
    return this.ledger.filter(
      (entry) =>
        entry.generationRunId === runId &&
        (entry.reason === "generation_run_refund_full" ||
          entry.reason === "generation_run_refund_prorata"),
    );
  }

  public getPassesByRun(runId: string): GenerationPass[] {
    return this.generationPassesByRun.get(runId)?.map((entry) => ({ ...entry })) ?? [];
  }

  public withTransaction<T>(callback: (tx: RepositoryTx) => Promise<T>): Promise<T> {
    return callback(this);
  }

  public async createGenerationRoot(userId: string): Promise<{ generationId: string }> {
    const now = new Date();
    const generationId = randomUUID();

    this.generations.set(generationId, {
      id: generationId,
      userId,
      state: "active",
      refundState: "none",
      visibility: "private",
      shareSlug: createShareSlug(),
      publishedAt: null,
      featuredVariantId: null,
      activeRunId: null,
      createdAt: now,
      updatedAt: now,
    });

    return { generationId };
  }

  public async createInitialRunBundle(
    input: CreateInitialRunTxInput,
  ): Promise<CreateInitialRunTxResult> {
    const now = new Date();
    const generationId = randomUUID();
    const requestId = randomUUID();
    const runId = randomUUID();

    const generation: Generation = {
      id: generationId,
      userId: input.userId,
      state: "active",
      refundState: "none",
      visibility: "private",
      shareSlug: createShareSlug(),
      publishedAt: null,
      featuredVariantId: null,
      activeRunId: runId,
      createdAt: now,
      updatedAt: now,
    };

    const generationRequest: StoredGenerationRequest = {
      id: requestId,
      generationId,
      userId: input.userId,
      sourceText: input.sourceText,
      requestedImageCount: input.requestedImageCount,
      creativeMode: input.creativeMode,
      controlsJson: input.controlsJson,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    };

    const run: GenerationRun = {
      id: runId,
      generationId,
      userId: input.userId,
      generationRequestId: requestId,
      refinementInstructionId: null,
      runNumber: 1,
      runSource: "initial",
      pipelineState: "queued",
      requestedImageCount: input.requestedImageCount,
      correlationId: input.correlationId,
      attemptCount: 1,
      retryCount: 0,
      maxRetryCount: 3,
      nextRetryAt: null,
      startedAt: null,
      completedAt: null,
      terminalReasonCode: null,
      terminalReasonMessage: null,
      refundAmount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.generations.set(generationId, generation);
    this.generationRequests.set(requestId, generationRequest);
    this.generationRequestsByIdempotency.set(`${input.userId}:${input.idempotencyKey}`, requestId);
    this.runs.set(runId, run);

    const accountId = this.creditAccountsByUser.get(input.userId);
    if (accountId === undefined) {
      throw new Error("CREDIT_ACCOUNT_NOT_FOUND");
    }

    const account = this.creditAccounts.get(accountId)!;
    account.balance += input.debitAmount;

    const debit: CreditLedgerEntry = {
      id: randomUUID(),
      userId: input.userId,
      creditAccountId: accountId,
      entryType: "debit",
      reason: "generation_run_debit",
      amount: input.debitAmount,
      generationRunId: runId,
      idempotencyKey: `debit:${runId}`,
      createdAt: now,
    };

    this.ledger.push(debit);
    this.ledgerByIdempotency.add(debit.idempotencyKey);

    const job: Job = {
      id: randomUUID(),
      runId,
      queueState: "queued",
      correlationId: input.correlationId,
      leasedAt: null,
      leaseExpiresAt: null,
      retryCount: 0,
      maxRetryCount: 3,
      nextRetryAt: null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
      deadLetteredAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      payloadJson: { source: "initial" },
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    this.jobsByRun.set(runId, job.id);

    await this.createModerationEvent({
      generationId,
      runId,
      imageVariantId: null,
      userId: input.userId,
      stage: "input_moderation",
      decision: input.inputModerationDecision,
      policyCode: input.inputModerationPolicyCode,
      message: input.inputModerationMessage,
      detailsJson: {},
    });

    return {
      generationId,
      runId,
    };
  }

  public async createRefineRunBundle(
    input: CreateRefineRunTxInput,
  ): Promise<CreateRefineRunTxResult> {
    const generation = this.generations.get(input.generationId);
    if (generation === undefined || generation.userId !== input.userId) {
      throw new Error("GENERATION_OWNERSHIP_VIOLATION");
    }

    const now = new Date();
    const refinementId = randomUUID();
    const runId = randomUUID();

    const runNumber =
      this.getRunsByGeneration(input.generationId).reduce((max, run) => Math.max(max, run.runNumber), 0) + 1;

    this.refinementInstructions.set(refinementId, {
      id: refinementId,
      generationId: input.generationId,
      userId: input.userId,
      basedOnRunId: input.basedOnRunId,
      instructionText: input.instructionText,
      controlsDeltaJson: input.controlsDeltaJson,
      requestedImageCount: input.requestedImageCount,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    });

    this.refinementByIdempotency.set(`${input.userId}:${input.idempotencyKey}`, refinementId);

    this.runs.set(runId, {
      id: runId,
      generationId: input.generationId,
      userId: input.userId,
      generationRequestId: null,
      refinementInstructionId: refinementId,
      runNumber,
      runSource: "refine",
      pipelineState: "queued",
      requestedImageCount: input.requestedImageCount,
      correlationId: input.correlationId,
      attemptCount: 1,
      retryCount: 0,
      maxRetryCount: 3,
      nextRetryAt: null,
      startedAt: null,
      completedAt: null,
      terminalReasonCode: null,
      terminalReasonMessage: null,
      refundAmount: 0,
      createdAt: now,
      updatedAt: now,
    });

    const accountId = this.creditAccountsByUser.get(input.userId);
    if (accountId === undefined) {
      throw new Error("CREDIT_ACCOUNT_NOT_FOUND");
    }

    const account = this.creditAccounts.get(accountId)!;
    account.balance += input.debitAmount;

    const debit: CreditLedgerEntry = {
      id: randomUUID(),
      userId: input.userId,
      creditAccountId: accountId,
      entryType: "debit",
      reason: "generation_run_debit",
      amount: input.debitAmount,
      generationRunId: runId,
      idempotencyKey: `debit:${runId}`,
      createdAt: now,
    };

    this.ledger.push(debit);
    this.ledgerByIdempotency.add(debit.idempotencyKey);

    const job: Job = {
      id: randomUUID(),
      runId,
      queueState: "queued",
      correlationId: input.correlationId,
      leasedAt: null,
      leaseExpiresAt: null,
      retryCount: 0,
      maxRetryCount: 3,
      nextRetryAt: null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
      deadLetteredAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      payloadJson: { source: "refine" },
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    this.jobsByRun.set(runId, job.id);

    await this.createModerationEvent({
      generationId: input.generationId,
      runId,
      imageVariantId: null,
      userId: input.userId,
      stage: "input_moderation",
      decision: input.inputModerationDecision,
      policyCode: input.inputModerationPolicyCode,
      message: input.inputModerationMessage,
      detailsJson: {},
    });

    return { runId };
  }

  public async createVariationRunBundle(
    input: CreateVariationRunTxInput,
  ): Promise<CreateVariationRunTxResult> {
    const generation = this.generations.get(input.generationId);
    if (generation === undefined || generation.userId !== input.userId) {
      throw new Error("GENERATION_OWNERSHIP_VIOLATION");
    }

    const baseVariant = this.variants.get(input.baseVariantId);
    if (
      baseVariant === undefined ||
      baseVariant.generationId !== input.sourceGenerationId ||
      (!input.allowForeignBaseVariant && baseVariant.userId !== input.userId)
    ) {
      throw new Error("BASE_VARIANT_NOT_FOUND_OR_OWNERSHIP_VIOLATION");
    }

    if (input.remixSourceType === "public_generation") {
      const remixGenerationId = input.remixSourceGenerationId ?? null;
      if (remixGenerationId === null) {
        throw new Error("PUBLIC_REMIX_SOURCE_GENERATION_REQUIRED");
      }

      const remixGeneration = this.generations.get(remixGenerationId);
      if (
        remixGeneration === undefined ||
        (remixGeneration.visibility !== "public" && remixGeneration.visibility !== "unlisted")
      ) {
        throw new Error("PUBLIC_REMIX_SOURCE_NOT_ALLOWED");
      }

      if (input.remixSourceVariantId !== null && input.remixSourceVariantId !== input.baseVariantId) {
        throw new Error("PUBLIC_REMIX_SOURCE_VARIANT_MISMATCH");
      }
    }

    const now = new Date();
    const refinementId = randomUUID();
    const runId = randomUUID();
    const variationRequestId = randomUUID();

    const runNumber =
      this.getRunsByGeneration(input.generationId).reduce((max, run) => Math.max(max, run.runNumber), 0) + 1;

    const parentVariation = [...this.variationRequests.values()].find(
      (entry) => entry.runId === baseVariant.runId,
    ) ?? null;

    let remixDepth = 0;
    let rootPublicGenerationId: string | null = null;
    let rootCreatorId: string | null = null;

    if (parentVariation !== null && parentVariation.rootPublicGenerationId !== null) {
      remixDepth = parentVariation.remixDepth + 1;
      rootPublicGenerationId = parentVariation.rootPublicGenerationId;
      rootCreatorId = parentVariation.rootCreatorId;
    }

    if (input.remixSourceType === "public_generation") {
      const remixGenerationId = input.remixSourceGenerationId!;
      const remixGeneration = this.generations.get(remixGenerationId)!;
      const sourceVariation = [...this.variationRequests.values()]
        .filter((entry) => entry.generationId === remixGenerationId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;

      if (sourceVariation !== null && sourceVariation.rootPublicGenerationId !== null) {
        remixDepth = sourceVariation.remixDepth + 1;
        rootPublicGenerationId = sourceVariation.rootPublicGenerationId;
        rootCreatorId = sourceVariation.rootCreatorId ?? remixGeneration.userId;
      } else {
        remixDepth = 1;
        rootPublicGenerationId = remixGenerationId;
        rootCreatorId = remixGeneration.userId;
      }
    }

    this.refinementInstructions.set(refinementId, {
      id: refinementId,
      generationId: input.generationId,
      userId: input.userId,
      basedOnRunId: baseVariant.runId,
      instructionText: input.instructionText,
      controlsDeltaJson: input.variationParametersJson,
      requestedImageCount: input.requestedImageCount,
      idempotencyKey: `variation:${input.idempotencyKey}`,
      createdAt: now,
    });

    this.refinementByIdempotency.set(`${input.userId}:variation:${input.idempotencyKey}`, refinementId);

    this.runs.set(runId, {
      id: runId,
      generationId: input.generationId,
      userId: input.userId,
      generationRequestId: null,
      refinementInstructionId: refinementId,
      runNumber,
      runSource: "refine",
      pipelineState: "queued",
      requestedImageCount: input.requestedImageCount,
      correlationId: input.correlationId,
      attemptCount: 1,
      retryCount: 0,
      maxRetryCount: 3,
      nextRetryAt: null,
      startedAt: null,
      completedAt: null,
      terminalReasonCode: null,
      terminalReasonMessage: null,
      refundAmount: 0,
      createdAt: now,
      updatedAt: now,
    });

    this.variationRequests.set(variationRequestId, {
      id: variationRequestId,
      generationId: input.generationId,
      runId,
      userId: input.userId,
      baseVariantId: input.baseVariantId,
      variationType: input.variationType,
      variationParametersJson: input.variationParametersJson,
      remixSourceType: input.remixSourceType ?? null,
      remixSourceGenerationId: input.remixSourceGenerationId ?? null,
      remixSourceVariantId: input.remixSourceVariantId ?? null,
      remixDepth,
      rootPublicGenerationId,
      rootCreatorId,
      requestedImageCount: input.requestedImageCount,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    });
    this.variationByIdempotency.set(`${input.userId}:${input.idempotencyKey}`, variationRequestId);

    const accountId = this.creditAccountsByUser.get(input.userId);
    if (accountId === undefined) {
      throw new Error("CREDIT_ACCOUNT_NOT_FOUND");
    }

    const account = this.creditAccounts.get(accountId)!;
    account.balance += input.debitAmount;

    const debit: CreditLedgerEntry = {
      id: randomUUID(),
      userId: input.userId,
      creditAccountId: accountId,
      entryType: "debit",
      reason: "generation_run_debit",
      amount: input.debitAmount,
      generationRunId: runId,
      idempotencyKey: `debit:${runId}`,
      createdAt: now,
    };

    this.ledger.push(debit);
    this.ledgerByIdempotency.add(debit.idempotencyKey);

    const job: Job = {
      id: randomUUID(),
      runId,
      queueState: "queued",
      correlationId: input.correlationId,
      leasedAt: null,
      leaseExpiresAt: null,
      retryCount: 0,
      maxRetryCount: 3,
      nextRetryAt: null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
      deadLetteredAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      payloadJson: {
        source: "variation",
        variation_type: input.variationType,
        base_variant_id: input.baseVariantId,
        remix_source_type: input.remixSourceType ?? null,
        remix_source_generation_id: input.remixSourceGenerationId ?? null,
        remix_source_variant_id: input.remixSourceVariantId ?? null,
        remix_depth: remixDepth,
        root_public_generation_id: rootPublicGenerationId,
        root_creator_id: rootCreatorId,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    this.jobsByRun.set(runId, job.id);

    await this.createModerationEvent({
      generationId: input.generationId,
      runId,
      imageVariantId: null,
      userId: input.userId,
      stage: "input_moderation",
      decision: input.inputModerationDecision,
      policyCode: input.inputModerationPolicyCode,
      message: input.inputModerationMessage,
      detailsJson: {
        source: "variation_generation",
        variation_type: input.variationType,
        remix_source_type: input.remixSourceType ?? null,
        remix_source_generation_id: input.remixSourceGenerationId ?? null,
        remix_source_variant_id: input.remixSourceVariantId ?? null,
        remix_depth: remixDepth,
        root_public_generation_id: rootPublicGenerationId,
        root_creator_id: rootCreatorId,
      },
    });

    return {
      variationRequestId,
      runId,
    };
  }

  public async updateGenerationActiveRun(generationId: string, runId: string): Promise<void> {
    const generation = this.generations.get(generationId);
    if (generation === undefined) {
      throw new Error("GENERATION_NOT_FOUND");
    }
    generation.activeRunId = runId;
    generation.updatedAt = new Date();
  }

  public async updateGenerationState(generationId: string, state: Generation["state"]): Promise<void> {
    const generation = this.generations.get(generationId);
    if (generation === undefined) {
      throw new Error("GENERATION_NOT_FOUND");
    }
    generation.state = state;
    generation.updatedAt = new Date();
  }

  public async updateGenerationRefundState(
    generationId: string,
    refundState: Generation["refundState"],
  ): Promise<void> {
    const generation = this.generations.get(generationId);
    if (generation === undefined) {
      throw new Error("GENERATION_NOT_FOUND");
    }
    generation.refundState = refundState;
    generation.updatedAt = new Date();
  }

  public async transitionRunState(params: {
    runId: string;
    from: GenerationRun["pipelineState"];
    to: GenerationRun["pipelineState"];
    terminalReasonCode?: string;
    terminalReasonMessage?: string;
    nextRetryAt?: Date | null;
    incrementRetryCount?: boolean;
    setStartedAt?: boolean;
    setCompletedAt?: boolean;
  }): Promise<GenerationRun> {
    if (!canTransitionRun(params.from, params.to)) {
      throw new Error(`ILLEGAL_RUN_TRANSITION:${params.from}->${params.to}`);
    }

    const run = this.runs.get(params.runId);
    if (run === undefined) {
      throw new Error("RUN_NOT_FOUND");
    }

    if (run.pipelineState !== params.from) {
      throw new Error("RUN_TRANSITION_CONFLICT");
    }

    run.pipelineState = params.to;
    run.updatedAt = new Date();

    if (params.incrementRetryCount === true) {
      run.retryCount += 1;
    }

    if (params.setStartedAt === true && run.startedAt === null) {
      run.startedAt = new Date();
    }

    if (params.setCompletedAt === true) {
      run.completedAt = new Date();
    }

    if (Object.prototype.hasOwnProperty.call(params, "nextRetryAt")) {
      run.nextRetryAt = params.nextRetryAt ?? null;
    }

    if (params.terminalReasonCode !== undefined) {
      run.terminalReasonCode = params.terminalReasonCode;
    }

    if (params.terminalReasonMessage !== undefined) {
      run.terminalReasonMessage = params.terminalReasonMessage;
    }

    this.runTransitions.push({
      runId: run.id,
      from: params.from,
      to: params.to,
    });

    return { ...run };
  }

  public async createModerationEvent(params: {
    generationId: string;
    runId: string | null;
    imageVariantId: string | null;
    userId: string;
    stage: ModerationEvent["stage"];
    decision: ModerationEvent["decision"];
    policyCode: string;
    message: string | null;
    detailsJson: Record<string, unknown>;
  }): Promise<ModerationEvent> {
    const event: ModerationEvent = {
      id: randomUUID(),
      generationId: params.generationId,
      runId: params.runId,
      imageVariantId: params.imageVariantId,
      userId: params.userId,
      stage: params.stage,
      decision: params.decision,
      policyCode: params.policyCode,
      message: params.message,
      detailsJson: params.detailsJson,
      createdAt: new Date(),
    };

    this.moderationEvents.set(event.id, event);
    return event;
  }

  public async createAnalysisArtifacts(input: CreateAnalysisArtifactsInput): Promise<void> {
    const now = new Date();

    const userIntent: UserIntent = {
      id: randomUUID(),
      generationId: input.generationId,
      runId: input.runId,
      userId: input.userId,
      intentJson: input.userIntent.intentJson,
      modelName: input.userIntent.modelName,
      confidence: input.userIntent.confidence,
      createdAt: now,
    };

    const emotionAnalysis: EmotionAnalysis = {
      id: randomUUID(),
      generationId: input.generationId,
      runId: input.runId,
      userId: input.userId,
      analysisJson: input.emotionAnalysis.analysisJson,
      modelName: input.emotionAnalysis.modelName,
      createdAt: now,
    };

    const creativeDirections: CreativeDirection[] = input.creativeDirections
      .slice()
      .sort((a, b) => a.directionIndex - b.directionIndex)
      .map((direction) => ({
        id: randomUUID(),
        generationId: input.generationId,
        runId: input.runId,
        userId: input.userId,
        directionIndex: direction.directionIndex,
        directionTitle: direction.directionTitle,
        directionJson: direction.directionJson,
        createdAt: now,
      }));

    const selectedCreativeDirection =
      input.visualPlan.selectedCreativeDirectionIndex === null
        ? null
        : creativeDirections.find(
          (direction) => direction.directionIndex === input.visualPlan.selectedCreativeDirectionIndex,
        ) ?? null;

    const visualPlan: VisualPlan = {
      id: randomUUID(),
      generationId: input.generationId,
      runId: input.runId,
      userId: input.userId,
      selectedCreativeDirectionId: selectedCreativeDirection?.id ?? null,
      planJson: input.visualPlan.planJson,
      explainabilityJson: input.visualPlan.explainabilityJson,
      createdAt: now,
      updatedAt: now,
    };

    this.userIntentsByRun.set(input.runId, userIntent);
    this.emotionAnalysesByRun.set(input.runId, emotionAnalysis);
    this.creativeDirectionsByRun.set(input.runId, creativeDirections);
    this.visualPlansByRun.set(input.runId, visualPlan);
  }

  public async updateVisualPlanExplainabilityByRun(params: {
    runId: string;
    explainabilityJson: VisualPlan["explainabilityJson"];
  }): Promise<void> {
    const visualPlan = this.visualPlansByRun.get(params.runId);
    if (visualPlan === undefined) {
      throw new Error("VISUAL_PLAN_NOT_FOUND");
    }
    visualPlan.explainabilityJson = params.explainabilityJson;
    visualPlan.updatedAt = new Date();
    this.visualPlansByRun.set(params.runId, visualPlan);
  }

  public async createGenerationPass(
    input: CreateGenerationPassInput,
  ): Promise<GenerationPass> {
    const now = new Date();
    const existing = this.generationPassesByRun.get(input.runId) ?? [];
    const foundIndex = existing.findIndex((entry) => entry.passType === input.passType);

    const pass: GenerationPass = {
      id: foundIndex >= 0 ? existing[foundIndex]!.id : randomUUID(),
      generationId: input.generationId,
      runId: input.runId,
      userId: input.userId,
      passType: input.passType,
      passIndex: input.passIndex,
      status: input.status,
      inputArtifactPaths: [...input.inputArtifactPaths],
      outputArtifactPaths: [...input.outputArtifactPaths],
      summary: input.summary,
      metadataJson: input.metadataJson,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      createdAt: foundIndex >= 0 ? existing[foundIndex]!.createdAt : now,
      updatedAt: now,
    };

    if (foundIndex >= 0) {
      existing[foundIndex] = pass;
    } else {
      existing.push(pass);
      existing.sort((a, b) => a.passIndex - b.passIndex);
    }
    this.generationPassesByRun.set(input.runId, existing);
    return { ...pass };
  }

  public async updateGenerationPass(params: {
    passId: string;
    from: GenerationPass["status"];
    to: GenerationPass["status"];
    inputArtifactPaths?: string[];
    outputArtifactPaths?: string[];
    summary?: string | null;
    metadataJson?: Record<string, unknown>;
    errorCode?: string | null;
    errorMessage?: string | null;
    setStartedAt?: boolean;
    setCompletedAt?: boolean;
  }): Promise<GenerationPass> {
    if (!canTransitionGenerationPass(params.from, params.to)) {
      throw new Error(`ILLEGAL_GENERATION_PASS_TRANSITION:${params.from}->${params.to}`);
    }

    for (const [runId, passes] of this.generationPassesByRun.entries()) {
      const index = passes.findIndex((entry) => entry.id === params.passId);
      if (index < 0) {
        continue;
      }

      const existing = passes[index]!;
      if (existing.status !== params.from) {
        throw new Error("GENERATION_PASS_TRANSITION_CONFLICT");
      }

      const now = new Date();
      const next: GenerationPass = {
        ...existing,
        status: params.to,
        inputArtifactPaths: params.inputArtifactPaths ?? existing.inputArtifactPaths,
        outputArtifactPaths: params.outputArtifactPaths ?? existing.outputArtifactPaths,
        summary: Object.prototype.hasOwnProperty.call(params, "summary")
          ? params.summary ?? null
          : existing.summary,
        metadataJson: params.metadataJson ?? existing.metadataJson,
        errorCode: Object.prototype.hasOwnProperty.call(params, "errorCode")
          ? params.errorCode ?? null
          : existing.errorCode,
        errorMessage: Object.prototype.hasOwnProperty.call(params, "errorMessage")
          ? params.errorMessage ?? null
          : existing.errorMessage,
        startedAt: params.setStartedAt === true
          ? existing.startedAt ?? now
          : existing.startedAt,
        completedAt: params.setCompletedAt === true
          ? now
          : existing.completedAt,
        updatedAt: now,
      };

      passes[index] = next;
      this.generationPassesByRun.set(runId, passes);
      return { ...next };
    }

    throw new Error("GENERATION_PASS_NOT_FOUND");
  }

  public async createProviderPayload(params: {
    generationId: string;
    runId: string;
    userId: string;
    providerType: "emotion_analysis" | "image_generation" | "safety_shaping";
    providerName: string;
    requestPayloadRedacted: Record<string, unknown>;
    responsePayloadRedacted: Record<string, unknown>;
    statusCode?: number;
    durationMs?: number;
  }): Promise<void> {
    this.providerPayloads.push({
      id: randomUUID(),
      generationId: params.generationId,
      runId: params.runId,
      providerType: params.providerType,
    });
  }

  public async insertImageVariants(
    inputs: Parameters<RepositoryTx["insertImageVariants"]>[0],
  ): Promise<ImageVariant[]> {
    const inserted: ImageVariant[] = [];

    for (const input of inputs) {
      const key = `${input.runId}:${input.variantIndex}`;
      const existingId = this.variantByRunIndex.get(key);
      const now = new Date();

      if (existingId !== undefined) {
        const current = this.variants.get(existingId)!;
        current.directionIndex = input.directionIndex;
        current.parentVariantId = input.parentVariantId;
        current.rootGenerationId = input.rootGenerationId;
        current.variationType = input.variationType;
        current.branchDepth = input.branchDepth;
        current.isUpscaled = input.isUpscaled;
        current.status = input.status;
        current.storageBucket = input.storageBucket;
        current.storagePath = input.storagePath;
        current.mimeType = input.mimeType;
        current.width = input.width;
        current.height = input.height;
        current.moderationDecision = input.moderationDecision;
        current.moderationReason = input.moderationReason;
        current.updatedAt = now;
        inserted.push({ ...current });
        continue;
      }

      const variant: ImageVariant = {
        id: randomUUID(),
        generationId: input.generationId,
        runId: input.runId,
        userId: input.userId,
        variantIndex: input.variantIndex,
        directionIndex: input.directionIndex,
        parentVariantId: input.parentVariantId,
        rootGenerationId: input.rootGenerationId,
        variationType: input.variationType,
        branchDepth: input.branchDepth,
        isUpscaled: input.isUpscaled,
        status: input.status,
        storageBucket: input.storageBucket,
        storagePath: input.storagePath,
        mimeType: input.mimeType,
        width: input.width,
        height: input.height,
        moderationDecision: input.moderationDecision,
        moderationReason: input.moderationReason,
        createdAt: now,
        updatedAt: now,
      };

      this.variants.set(variant.id, variant);
      this.variantByRunIndex.set(key, variant.id);
      inserted.push({ ...variant });
    }

    return inserted;
  }

  public async getRunById(runId: string): Promise<GenerationRun | null> {
    const run = this.runs.get(runId);
    return run ? { ...run } : null;
  }

  public async getJobByRunId(runId: string): Promise<Job | null> {
    const job = this.getJobByRun(runId);
    return job ? { ...job } : null;
  }

  public async createRefundLedgerEntryIfAbsent(params: {
    creditAccountId: string;
    userId: string;
    generationRunId: string;
    amount: number;
    reason: "generation_run_refund_full" | "generation_run_refund_prorata";
    idempotencyKey: string;
    metadataJson: Record<string, unknown>;
  }): Promise<boolean> {
    if (this.ledgerByIdempotency.has(params.idempotencyKey)) {
      return false;
    }

    this.ledgerByIdempotency.add(params.idempotencyKey);
    this.ledger.push({
      id: randomUUID(),
      userId: params.userId,
      creditAccountId: params.creditAccountId,
      entryType: "refund",
      reason: params.reason,
      amount: params.amount,
      generationRunId: params.generationRunId,
      idempotencyKey: params.idempotencyKey,
      createdAt: new Date(),
    });

    const account = this.creditAccounts.get(params.creditAccountId);
    if (account !== undefined) {
      account.balance += params.amount;
    }

    return true;
  }

  public async updateRunRefundAmount(runId: string, refundAmount: number): Promise<void> {
    const run = this.runs.get(runId);
    if (run === undefined) {
      throw new Error("RUN_NOT_FOUND");
    }
    run.refundAmount = refundAmount;
    run.updatedAt = new Date();
  }

  public async findGenerationRequestByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<
    | {
        generationId: string;
        runId: string;
        sourceText: string;
        requestedImageCount: number;
        creativeMode: "fast" | "balanced" | "directed";
        controlsJson: Record<string, unknown>;
      }
    | null
  > {
    const requestId = this.generationRequestsByIdempotency.get(`${userId}:${idempotencyKey}`);
    if (requestId === undefined) {
      return null;
    }

    const request = this.generationRequests.get(requestId);
    if (request === undefined) {
      return null;
    }

    const run = [...this.runs.values()]
      .filter((entry) => entry.generationRequestId === request.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (run === undefined) {
      return null;
    }

    return {
      generationId: request.generationId,
      runId: run.id,
      sourceText: request.sourceText,
      requestedImageCount: request.requestedImageCount,
      creativeMode: request.creativeMode,
      controlsJson: request.controlsJson,
    };
  }

  public async findRefinementInstructionByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<
    | {
        generationId: string;
        runId: string;
        basedOnRunId: string | null;
        instructionText: string;
        requestedImageCount: number;
        controlsDeltaJson: Record<string, unknown>;
      }
    | null
  > {
    const refinementId = this.refinementByIdempotency.get(`${userId}:${idempotencyKey}`);
    if (refinementId === undefined) {
      return null;
    }

    const refinement = this.refinementInstructions.get(refinementId);
    if (refinement === undefined) {
      return null;
    }

    const run = [...this.runs.values()]
      .filter((entry) => entry.refinementInstructionId === refinement.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (run === undefined) {
      return null;
    }

    return {
      generationId: refinement.generationId,
      runId: run.id,
      basedOnRunId: refinement.basedOnRunId,
      instructionText: refinement.instructionText,
      requestedImageCount: refinement.requestedImageCount,
      controlsDeltaJson: refinement.controlsDeltaJson,
    };
  }

  public async findVariationRequestByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<
    | {
        variationRequestId: string;
        generationId: string;
        runId: string;
        baseVariantId: string;
        variationType: VariationType;
        variationParametersJson: Record<string, unknown>;
        remixSourceType: "public_generation" | null;
        remixSourceGenerationId: string | null;
        remixSourceVariantId: string | null;
        remixDepth: number;
        rootPublicGenerationId: string | null;
        rootCreatorId: string | null;
        requestedImageCount: number;
      }
    | null
  > {
    const variationId = this.variationByIdempotency.get(`${userId}:${idempotencyKey}`);
    if (variationId === undefined) {
      return null;
    }

    const variation = this.variationRequests.get(variationId);
    if (variation === undefined) {
      return null;
    }

    return {
      variationRequestId: variation.id,
      generationId: variation.generationId,
      runId: variation.runId,
      baseVariantId: variation.baseVariantId,
      variationType: variation.variationType,
      variationParametersJson: variation.variationParametersJson,
      remixSourceType: variation.remixSourceType,
      remixSourceGenerationId: variation.remixSourceGenerationId,
      remixSourceVariantId: variation.remixSourceVariantId,
      remixDepth: variation.remixDepth,
      rootPublicGenerationId: variation.rootPublicGenerationId,
      rootCreatorId: variation.rootCreatorId,
      requestedImageCount: variation.requestedImageCount,
    };
  }

  public async getUserSegment(userId: string): Promise<UserSegment | null> {
    return this.segmentByUser.get(userId) ?? null;
  }

  public async getUserDebitUsageSince(params: {
    userId: string;
    since: Date;
  }): Promise<number> {
    return this.ledger
      .filter(
        (entry) =>
          entry.userId === params.userId &&
          entry.reason === "generation_run_debit" &&
          entry.amount < 0 &&
          entry.createdAt >= params.since,
      )
      .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  }

  public async getCreditBalance(
    userId: string,
  ): Promise<{ creditAccountId: string; balance: number } | null> {
    const accountId = this.creditAccountsByUser.get(userId);
    if (accountId === undefined) {
      return null;
    }

    const account = this.creditAccounts.get(accountId);
    if (account === undefined) {
      return null;
    }

    return {
      creditAccountId: account.id,
      balance: account.balance,
    };
  }

  public async getImageVariantForUser(
    imageVariantId: string,
    userId: string,
  ): Promise<ImageVariant | null> {
    const variant = this.variants.get(imageVariantId);
    if (variant === undefined || variant.userId !== userId) {
      return null;
    }
    return { ...variant };
  }

  public async getPublicVariantForRemix(params: {
    sourceGenerationId: string;
    sourceVariantId: string;
  }): Promise<ImageVariant | null> {
    const generation = this.generations.get(params.sourceGenerationId);
    if (
      generation === undefined ||
      (generation.visibility !== "public" && generation.visibility !== "unlisted")
    ) {
      return null;
    }

    const variant = this.variants.get(params.sourceVariantId);
    if (
      variant === undefined ||
      variant.generationId !== params.sourceGenerationId ||
      variant.status !== "completed"
    ) {
      return null;
    }

    return { ...variant };
  }

  public async getGenerationDetailForUser(
    generationId: string,
    userId: string,
  ): Promise<RunDetailAggregate | null> {
    const generation = this.generations.get(generationId);
    if (generation === undefined || generation.userId !== userId) {
      return null;
    }

    const runs = this.getRunsByGeneration(generationId)
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const activeRun = generation.activeRunId
      ? runs.find((run) => run.id === generation.activeRunId) ?? null
      : null;

    const variants = [...this.variants.values()]
      .filter((variant) => variant.generationId === generationId && variant.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const artifactRunId = generation.activeRunId ?? runs[0]?.id ?? null;
    const userIntent = artifactRunId !== null
      ? this.userIntentsByRun.get(artifactRunId) ?? null
      : null;
    const emotionAnalysis = artifactRunId !== null
      ? this.emotionAnalysesByRun.get(artifactRunId) ?? null
      : null;
    const creativeDirections = artifactRunId !== null
      ? this.creativeDirectionsByRun.get(artifactRunId) ?? []
      : [];
    const visualPlan = artifactRunId !== null
      ? this.visualPlansByRun.get(artifactRunId) ?? null
      : null;

    return {
      generation,
      activeRun,
      runs,
      passes: artifactRunId !== null
        ? this.generationPassesByRun.get(artifactRunId) ?? []
        : [],
      variants,
      userIntent,
      emotionAnalysis,
      creativeDirections,
      visualPlan,
    };
  }

  public async getGenerationDetailForService(
    generationId: string,
  ): Promise<RunDetailAggregate | null> {
    const generation = this.generations.get(generationId);
    if (generation === undefined) {
      return null;
    }

    const runs = this.getRunsByGeneration(generationId).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    const activeRun = generation.activeRunId
      ? runs.find((run) => run.id === generation.activeRunId) ?? null
      : null;

    const variants = [...this.variants.values()]
      .filter((variant) => variant.generationId === generationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const artifactRunId = generation.activeRunId ?? runs[0]?.id ?? null;
    const userIntent = artifactRunId !== null
      ? this.userIntentsByRun.get(artifactRunId) ?? null
      : null;
    const emotionAnalysis = artifactRunId !== null
      ? this.emotionAnalysesByRun.get(artifactRunId) ?? null
      : null;
    const creativeDirections = artifactRunId !== null
      ? this.creativeDirectionsByRun.get(artifactRunId) ?? []
      : [];
    const visualPlan = artifactRunId !== null
      ? this.visualPlansByRun.get(artifactRunId) ?? null
      : null;

    return {
      generation,
      activeRun,
      runs,
      passes: artifactRunId !== null
        ? this.generationPassesByRun.get(artifactRunId) ?? []
        : [],
      variants,
      userIntent,
      emotionAnalysis,
      creativeDirections,
      visualPlan,
    };
  }

  public async getPublicGenerationByShareSlug(params: {
    shareSlug: string;
    includeUnlisted: boolean;
  }): Promise<PublicGenerationAggregate | null> {
    const generation = [...this.generations.values()].find((entry) =>
      entry.shareSlug === params.shareSlug &&
      (entry.visibility === "public" || (params.includeUnlisted && entry.visibility === "unlisted"))
    );
    if (generation === undefined) {
      return null;
    }

    const aggregate = await this.getGenerationDetailForService(generation.id);
    if (aggregate === null) {
      return null;
    }

    const firstVariation = [...this.variationRequests.values()]
      .filter((entry) => entry.generationId === generation.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;

    const derivedPublicGenerationIds = [...new Set(
      [...this.variationRequests.values()]
        .filter((entry) => entry.remixSourceGenerationId === generation.id)
        .filter((entry) => {
          const childGeneration = this.generations.get(entry.generationId);
          return childGeneration !== undefined &&
            (childGeneration.visibility === "public" || childGeneration.visibility === "unlisted");
        })
        .map((entry) => entry.generationId),
    )];

    const branchGenerationIds = new Set(
      [...this.variationRequests.values()]
        .filter((entry) => entry.rootPublicGenerationId === generation.id)
        .filter((entry) => {
          const childGeneration = this.generations.get(entry.generationId);
          return childGeneration !== undefined &&
            (childGeneration.visibility === "public" || childGeneration.visibility === "unlisted");
        })
        .map((entry) => entry.generationId),
    );

    const creatorPublicGenerationCount = [...this.generations.values()].filter(
      (entry) => entry.userId === generation.userId && entry.visibility === "public",
    ).length;
    const totalPublicVariants = aggregate.variants.filter((variant) => variant.status === "completed").length;

    return {
      ...aggregate,
      variants: aggregate.variants.filter((variant) => variant.status === "completed"),
      creatorDisplayName: this.displayNameByUser.get(generation.userId) ?? "Creator",
      creatorProfileHandle: this.profileHandleByUser.get(generation.userId) ?? `creator_${generation.userId.slice(0, 8)}`,
      creatorUserId: generation.userId,
      socialProof: {
        remixCount: derivedPublicGenerationIds.length,
        branchCount: branchGenerationIds.size,
        totalPublicVariants,
        creatorPublicGenerationCount,
      },
      lineage: {
        remixDepth: firstVariation?.remixDepth ?? 0,
        rootPublicGenerationId: firstVariation?.rootPublicGenerationId ?? null,
        rootCreatorId: firstVariation?.rootCreatorId ?? null,
        remixSourceGenerationId: firstVariation?.remixSourceGenerationId ?? null,
        remixSourceVariantId: firstVariation?.remixSourceVariantId ?? null,
        derivedPublicGenerationCount: derivedPublicGenerationIds.length,
        derivedPublicGenerationIds,
      },
    };
  }

  public async listGenerationHistoryForUser(params: {
    userId: string;
    limit: number;
    cursor: string | null;
  }): Promise<GenerationHistoryPage> {
    let records = [...this.generations.values()]
      .filter((generation) => generation.userId === params.userId)
      .sort((a, b) => {
        const ts = b.createdAt.getTime() - a.createdAt.getTime();
        if (ts !== 0) {
          return ts;
        }
        return b.id.localeCompare(a.id);
      });

    if (params.cursor !== null) {
      const decoded = decodeCursor(params.cursor);
      records = records.filter((generation) => {
        if (generation.createdAt.getTime() < decoded.createdAt.getTime()) {
          return true;
        }
        if (generation.createdAt.getTime() > decoded.createdAt.getTime()) {
          return false;
        }
        return generation.id < decoded.generationId;
      });
    }

    const sliced = records.slice(0, params.limit + 1);
    const hasMore = sliced.length > params.limit;
    const page = hasMore ? sliced.slice(0, params.limit) : sliced;

    const items: GenerationHistoryRow[] = page.map((generation) => {
      const activeRun = generation.activeRunId ? this.runs.get(generation.activeRunId) : null;
      const latestVariant = [...this.variants.values()]
        .filter((variant) => variant.generationId === generation.id && variant.status === "completed")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

      return {
        generationId: generation.id,
        activeRunState: activeRun?.pipelineState ?? "queued",
        createdAt: generation.createdAt,
        latestVariantThumbnailPath: latestVariant?.storagePath ?? null,
        totalRuns: this.getRunsByGeneration(generation.id).length,
      };
    });

    const lastItem = items[items.length - 1];

    return {
      items,
      nextCursor:
        hasMore && lastItem !== undefined
          ? encodeCursor(lastItem.createdAt, lastItem.generationId)
          : null,
    };
  }

  public async listPublicGallery(params: {
    limit: number;
    cursor: string | null;
  }): Promise<PublicGalleryPage> {
    let records = [...this.generations.values()]
      .filter((generation) => generation.visibility === "public" && generation.publishedAt !== null)
      .sort((a, b) => {
        const ts = (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
        if (ts !== 0) {
          return ts;
        }
        return b.id.localeCompare(a.id);
      });

    if (params.cursor !== null) {
      const decoded = decodeCursor(params.cursor);
      records = records.filter((generation) => {
        const publishedAt = generation.publishedAt;
        if (publishedAt === null) {
          return false;
        }
        if (publishedAt.getTime() < decoded.createdAt.getTime()) {
          return true;
        }
        if (publishedAt.getTime() > decoded.createdAt.getTime()) {
          return false;
        }
        return generation.id < decoded.generationId;
      });
    }

    const sliced = records.slice(0, params.limit + 1);
    const hasMore = sliced.length > params.limit;
    const page = hasMore ? sliced.slice(0, params.limit) : sliced;

    const items = page.map((generation) => {
      const runs = this.getRunsByGeneration(generation.id);
      const artifactRunId = generation.activeRunId ?? runs[0]?.id ?? null;
      const visualPlan = artifactRunId !== null
        ? this.visualPlansByRun.get(artifactRunId) ?? null
        : null;
      const selectedDirection = artifactRunId !== null
        ? (this.creativeDirectionsByRun.get(artifactRunId) ?? []).find(
          (direction) => direction.id === visualPlan?.selectedCreativeDirectionId,
        ) ?? null
        : null;
      const allVariants = [...this.variants.values()]
        .filter((variant) => variant.generationId === generation.id && variant.status === "completed")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const featuredVariant = generation.featuredVariantId === null
        ? null
        : allVariants.find((variant) => variant.id === generation.featuredVariantId) ?? null;
      const latestVariant = allVariants[0] ?? null;
      const styleTags = selectedDirection?.directionJson.styleTags ?? [];
      const moodFromDirection = selectedDirection?.directionJson.colorPalette.mood;
      const moodFromPlan = visualPlan?.planJson.colorStrategy.mood;
      const remixGenerationIds = new Set(
        [...this.variationRequests.values()]
          .filter((entry) => entry.remixSourceGenerationId === generation.id)
          .filter((entry) => {
            const childGeneration = this.generations.get(entry.generationId);
            return childGeneration !== undefined &&
              (childGeneration.visibility === "public" || childGeneration.visibility === "unlisted");
          })
          .map((entry) => entry.generationId),
      );
      const branchGenerationIds = new Set(
        [...this.variationRequests.values()]
          .filter((entry) => entry.rootPublicGenerationId === generation.id)
          .filter((entry) => {
            const childGeneration = this.generations.get(entry.generationId);
            return childGeneration !== undefined &&
              (childGeneration.visibility === "public" || childGeneration.visibility === "unlisted");
          })
          .map((entry) => entry.generationId),
      );
      const creatorPublicGenerationCount = [...this.generations.values()].filter(
        (entry) => entry.userId === generation.userId && entry.visibility === "public",
      ).length;

      return {
        generationId: generation.id,
        shareSlug: generation.shareSlug,
        visibility: "public" as const,
        publishedAt: generation.publishedAt ?? generation.createdAt,
        creatorDisplayName: this.displayNameByUser.get(generation.userId) ?? "Creator",
        creatorProfileHandle: this.profileHandleByUser.get(generation.userId) ?? `creator_${generation.userId.slice(0, 8)}`,
        summary:
          visualPlan?.explainabilityJson.summary ??
          visualPlan?.planJson.summary ??
          "Pixora generation",
        styleTags,
        moodTags: [moodFromDirection, moodFromPlan].filter(
          (entry): entry is string => entry !== undefined && entry !== null && entry.length > 0,
        ),
        featuredImagePath: (featuredVariant ?? latestVariant)?.storagePath ?? null,
        totalRuns: runs.length,
        variationCount: allVariants.filter((variant) => variant.parentVariantId !== null).length,
        refinementCount: Math.max(runs.length - 1, 0),
        remixCount: remixGenerationIds.size,
        branchCount: branchGenerationIds.size,
        totalPublicVariants: allVariants.length,
        creatorPublicGenerationCount,
      };
    });

    const lastItem = items[items.length - 1];

    return {
      items,
      nextCursor:
        hasMore && lastItem !== undefined
          ? encodeCursor(lastItem.publishedAt, lastItem.generationId)
          : null,
    };
  }

  public async updateGenerationVisibilityForUser(params: {
    generationId: string;
    userId: string;
    visibility: Generation["visibility"];
    featuredVariantId: string | null;
  }): Promise<Generation | null> {
    const generation = this.generations.get(params.generationId);
    if (generation === undefined || generation.userId !== params.userId) {
      return null;
    }

    if (params.featuredVariantId !== null) {
      const variant = this.variants.get(params.featuredVariantId);
      if (
        variant === undefined ||
        variant.userId !== params.userId ||
        variant.generationId !== params.generationId ||
        variant.status !== "completed"
      ) {
        throw new Error("FEATURED_VARIANT_NOT_ALLOWED");
      }
    }

    generation.visibility = params.visibility;
    generation.featuredVariantId = params.featuredVariantId;
    generation.publishedAt =
      params.visibility === "private"
        ? null
        : generation.publishedAt ?? new Date();
    generation.updatedAt = new Date();

    this.generations.set(generation.id, generation);
    return { ...generation };
  }

  public async getRunExecutionContext(runId: string): Promise<RunExecutionContext | null> {
    const run = this.runs.get(runId);
    if (run === undefined) {
      return null;
    }

    const generation = this.generations.get(run.generationId);
    if (generation === undefined) {
      return null;
    }

    const request =
      run.generationRequestId !== null
        ? this.generationRequests.get(run.generationRequestId) ?? null
        : null;

    const baseRequest = [...this.generationRequests.values()]
      .filter((entry) => entry.generationId === run.generationId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;

    const refinement =
      run.refinementInstructionId !== null
        ? this.refinementInstructions.get(run.refinementInstructionId) ?? null
        : null;
    const variationRequest = [...this.variationRequests.values()].find(
      (entry) => entry.runId === run.id,
    ) ?? null;
    const baseVariant = variationRequest !== null
      ? this.variants.get(variationRequest.baseVariantId) ?? null
      : null;
    const baseVisualPlan = baseVariant !== null
      ? this.visualPlansByRun.get(baseVariant.runId)?.planJson ?? null
      : null;

    return {
      generation,
      run,
      generationRequestSourceText: request?.sourceText ?? baseRequest?.sourceText ?? null,
      generationRequestCreativeMode: request?.creativeMode ?? baseRequest?.creativeMode ?? null,
      generationRequestControlsJson: request?.controlsJson ?? baseRequest?.controlsJson ?? null,
      refinementInstructionText: refinement?.instructionText ?? null,
      refinementControlsDeltaJson: refinement?.controlsDeltaJson ?? null,
      variationType: variationRequest?.variationType ?? null,
      variationParametersJson: variationRequest?.variationParametersJson ?? null,
      baseVariantId: variationRequest?.baseVariantId ?? null,
      baseVariantRunId: baseVariant?.runId ?? null,
      baseVariantStoragePath: baseVariant?.storagePath ?? null,
      baseVariantBranchDepth: baseVariant?.branchDepth ?? null,
      baseVariantVariationType: baseVariant?.variationType ?? null,
      baseVisualPlan,
    };
  }

  public async countCompletedVariantsByRun(runId: string): Promise<number> {
    return [...this.variants.values()].filter(
      (variant) => variant.runId === runId && variant.status === "completed",
    ).length;
  }

  public async getDebitLedgerAmountByRun(runId: string): Promise<number | null> {
    const entry = this.ledger.find(
      (ledgerEntry) =>
        ledgerEntry.generationRunId === runId && ledgerEntry.reason === "generation_run_debit",
    );

    return entry?.amount ?? null;
  }

  public async leaseNextJob(params: { leaseSeconds: number; now: Date }): Promise<Job | null> {
    const eligible = [...this.jobs.values()]
      .filter((job) => {
        if (!(job.queueState === "queued" || job.queueState === "retry_wait")) {
          return false;
        }

        if (job.nextRetryAt !== null && job.nextRetryAt.getTime() > params.now.getTime()) {
          return false;
        }

        if (
          job.leasedAt !== null &&
          job.leaseExpiresAt !== null &&
          job.leaseExpiresAt.getTime() > params.now.getTime()
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (eligible === undefined) {
      return null;
    }

    eligible.queueState = "leased";
    eligible.leasedAt = params.now;
    eligible.leaseExpiresAt = new Date(params.now.getTime() + params.leaseSeconds * 1000);
    eligible.updatedAt = new Date();

    return eligible;
  }

  public async updateJobState(params: {
    jobId: string;
    from: Job["queueState"];
    to: Job["queueState"];
    retryCount?: number;
    nextRetryAt?: Date | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  }): Promise<Job | null> {
    const job = this.jobs.get(params.jobId);
    if (job === undefined || job.queueState !== params.from) {
      return null;
    }

    if (!canTransitionJob(params.from, params.to) && params.from !== params.to) {
      throw new Error(`ILLEGAL_JOB_TRANSITION:${params.from}->${params.to}`);
    }

    job.queueState = params.to;
    job.updatedAt = new Date();

    if (params.retryCount !== undefined) {
      job.retryCount = params.retryCount;
    }

    if (Object.prototype.hasOwnProperty.call(params, "nextRetryAt")) {
      job.nextRetryAt = params.nextRetryAt ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(params, "lastErrorCode")) {
      job.lastErrorCode = params.lastErrorCode ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(params, "lastErrorMessage")) {
      job.lastErrorMessage = params.lastErrorMessage ?? null;
    }

    if (params.to === "completed") {
      job.completedAt = new Date();
    }
    if (params.to === "failed") {
      job.failedAt = new Date();
    }
    if (params.to === "cancelled") {
      job.cancelledAt = new Date();
    }
    if (params.to === "dead_letter") {
      job.deadLetteredAt = new Date();
    }

    return job;
  }

  public async getUserAbuseSignals(params: {
    userId: string;
    now: Date;
  }): Promise<{
      generationDebitCreditsLast24h: number;
      generationRunsLast10m: number;
      refineRunsLast10m: number;
      hardBlocksLast30m: number;
    }> {
    const debitSince = params.now.getTime() - 24 * 60 * 60 * 1000;
    const runsSince = params.now.getTime() - 10 * 60 * 1000;
    const blocksSince = params.now.getTime() - 30 * 60 * 1000;

    let generationDebitCreditsLast24h = 0;
    for (const entry of this.ledger) {
      if (
        entry.userId === params.userId &&
        entry.reason === "generation_run_debit" &&
        entry.amount < 0 &&
        entry.createdAt.getTime() >= debitSince
      ) {
        generationDebitCreditsLast24h += -entry.amount;
      }
    }

    let generationRunsLast10m = 0;
    let refineRunsLast10m = 0;
    for (const run of this.runs.values()) {
      if (run.userId !== params.userId || run.createdAt.getTime() < runsSince) {
        continue;
      }
      generationRunsLast10m += 1;
      if (run.runSource === "refine") {
        refineRunsLast10m += 1;
      }
    }

    let hardBlocksLast30m = 0;
    for (const event of this.moderationEvents.values()) {
      if (
        event.userId === params.userId &&
        event.stage === "input_moderation" &&
        event.decision === "hard_block" &&
        event.createdAt.getTime() >= blocksSince
      ) {
        hardBlocksLast30m += 1;
      }
    }

    return {
      generationDebitCreditsLast24h,
      generationRunsLast10m,
      refineRunsLast10m,
      hardBlocksLast30m,
    };
  }

  public async getQueueOperationalStats(params: {
    now: Date;
    staleSeconds: number;
  }): Promise<{
      queuedCount: number;
      retryWaitCount: number;
      leasedCount: number;
      runningCount: number;
      deadLetterCount: number;
      failedCount: number;
      oldestQueuedAt: Date | null;
      staleLeasedCount: number;
      staleRunningCount: number;
    }> {
    let queuedCount = 0;
    let retryWaitCount = 0;
    let leasedCount = 0;
    let runningCount = 0;
    let deadLetterCount = 0;
    let failedCount = 0;
    let oldestQueuedAt: Date | null = null;
    let staleLeasedCount = 0;
    let staleRunningCount = 0;

    const staleCutoff = params.now.getTime() - params.staleSeconds * 1000;

    for (const job of this.jobs.values()) {
      if (job.queueState === "queued") {
        queuedCount += 1;
        if (oldestQueuedAt === null || job.createdAt.getTime() < oldestQueuedAt.getTime()) {
          oldestQueuedAt = job.createdAt;
        }
      }

      if (job.queueState === "retry_wait") {
        retryWaitCount += 1;
        if (oldestQueuedAt === null || job.createdAt.getTime() < oldestQueuedAt.getTime()) {
          oldestQueuedAt = job.createdAt;
        }
      }

      if (job.queueState === "leased") {
        leasedCount += 1;
        if (
          job.leaseExpiresAt !== null &&
          job.leaseExpiresAt.getTime() <= params.now.getTime()
        ) {
          staleLeasedCount += 1;
        }
      }

      if (job.queueState === "running") {
        runningCount += 1;
        if (job.updatedAt.getTime() <= staleCutoff) {
          staleRunningCount += 1;
        }
      }

      if (job.queueState === "dead_letter") {
        deadLetterCount += 1;
      }
      if (job.queueState === "failed") {
        failedCount += 1;
      }
    }

    return {
      queuedCount,
      retryWaitCount,
      leasedCount,
      runningCount,
      deadLetterCount,
      failedCount,
      oldestQueuedAt,
      staleLeasedCount,
      staleRunningCount,
    };
  }
}
