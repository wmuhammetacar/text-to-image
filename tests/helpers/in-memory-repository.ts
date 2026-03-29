import { randomUUID } from "node:crypto";
import type {
  CreateAnalysisArtifactsInput,
  CreateInitialRunTxInput,
  CreateInitialRunTxResult,
  CreateRefineRunTxInput,
  CreateRefineRunTxResult,
  GenerationHistoryPage,
  GenerationHistoryRow,
  Repository,
  RepositoryTx,
  RunDetailAggregate,
  RunExecutionContext,
} from "@vi/application";
import type {
  Generation,
  GenerationRun,
  ImageVariant,
  Job,
  ModerationEvent,
} from "@vi/domain";
import { canTransitionJob, canTransitionRun } from "@vi/domain";

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

export class InMemoryRepository implements Repository, RepositoryTx {
  private readonly generations = new Map<string, Generation>();
  private readonly generationRequests = new Map<string, StoredGenerationRequest>();
  private readonly generationRequestsByIdempotency = new Map<string, string>();
  private readonly refinementInstructions = new Map<string, StoredRefinementInstruction>();
  private readonly refinementByIdempotency = new Map<string, string>();
  private readonly runs = new Map<string, GenerationRun>();
  private readonly jobs = new Map<string, Job>();
  private readonly jobsByRun = new Map<string, string>();
  private readonly variants = new Map<string, ImageVariant>();
  private readonly variantByRunIndex = new Map<string, string>();
  private readonly moderationEvents = new Map<string, ModerationEvent>();
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

  public seedUser(userId: string, balance = 100): void {
    const accountId = randomUUID();
    this.creditAccounts.set(accountId, {
      id: accountId,
      userId,
      balance,
    });
    this.creditAccountsByUser.set(userId, accountId);
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

  public withTransaction<T>(callback: (tx: RepositoryTx) => Promise<T>): Promise<T> {
    return callback(this);
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

  public async createAnalysisArtifacts(_input: CreateAnalysisArtifactsInput): Promise<void> {
    return;
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

    return {
      generation,
      activeRun,
      runs,
      variants,
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

    return {
      generation,
      activeRun,
      runs,
      variants,
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

    const refinement =
      run.refinementInstructionId !== null
        ? this.refinementInstructions.get(run.refinementInstructionId) ?? null
        : null;

    return {
      generation,
      run,
      generationRequestSourceText: request?.sourceText ?? null,
      generationRequestCreativeMode: request?.creativeMode ?? null,
      refinementInstructionText: refinement?.instructionText ?? null,
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
