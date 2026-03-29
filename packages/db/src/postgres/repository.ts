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
  GenerationState,
  ImageVariant,
  Job,
  ModerationEvent,
} from "@vi/domain";
import { canTransitionJob, canTransitionRun } from "@vi/domain";
import type { PoolClient, QueryResultRow } from "pg";
import { PostgresClient, type SqlExecutor } from "./client";

interface GenerationRow extends QueryResultRow {
  id: string;
  user_id: string;
  state: Generation["state"];
  refund_state: Generation["refundState"];
  active_run_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface GenerationRunRow extends QueryResultRow {
  id: string;
  generation_id: string;
  user_id: string;
  generation_request_id: string | null;
  refinement_instruction_id: string | null;
  run_number: number;
  run_source: "initial" | "refine";
  pipeline_state: GenerationRun["pipelineState"];
  requested_image_count: number;
  correlation_id: string;
  attempt_count: number;
  retry_count: number;
  max_retry_count: number;
  next_retry_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  terminal_reason_code: string | null;
  terminal_reason_message: string | null;
  refund_amount: number;
  created_at: Date;
  updated_at: Date;
}

interface ImageVariantRow extends QueryResultRow {
  id: string;
  generation_id: string;
  run_id: string;
  user_id: string;
  variant_index: number;
  direction_index: number | null;
  status: ImageVariant["status"];
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  moderation_decision: ImageVariant["moderationDecision"];
  moderation_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface JobRow extends QueryResultRow {
  id: string;
  run_id: string;
  queue_state: Job["queueState"];
  correlation_id: string;
  leased_at: Date | null;
  lease_expires_at: Date | null;
  retry_count: number;
  max_retry_count: number;
  next_retry_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
  cancelled_at: Date | null;
  dead_lettered_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  payload_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function mapGeneration(row: GenerationRow): Generation {
  return {
    id: row.id,
    userId: row.user_id,
    state: row.state,
    refundState: row.refund_state,
    activeRunId: row.active_run_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapGenerationRun(row: GenerationRunRow): GenerationRun {
  return {
    id: row.id,
    generationId: row.generation_id,
    userId: row.user_id,
    generationRequestId: row.generation_request_id,
    refinementInstructionId: row.refinement_instruction_id,
    runNumber: row.run_number,
    runSource: row.run_source,
    pipelineState: row.pipeline_state,
    requestedImageCount: row.requested_image_count,
    correlationId: row.correlation_id,
    attemptCount: row.attempt_count,
    retryCount: row.retry_count,
    maxRetryCount: row.max_retry_count,
    nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at) : null,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    terminalReasonCode: row.terminal_reason_code,
    terminalReasonMessage: row.terminal_reason_message,
    refundAmount: row.refund_amount,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapImageVariant(row: ImageVariantRow): ImageVariant {
  return {
    id: row.id,
    generationId: row.generation_id,
    runId: row.run_id,
    userId: row.user_id,
    variantIndex: row.variant_index,
    directionIndex: row.direction_index,
    status: row.status,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    moderationDecision: row.moderation_decision,
    moderationReason: row.moderation_reason,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    runId: row.run_id,
    queueState: row.queue_state,
    correlationId: row.correlation_id,
    leasedAt: row.leased_at ? new Date(row.leased_at) : null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
    retryCount: row.retry_count,
    maxRetryCount: row.max_retry_count,
    nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    failedAt: row.failed_at ? new Date(row.failed_at) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
    deadLetteredAt: row.dead_lettered_at ? new Date(row.dead_lettered_at) : null,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    payloadJson: row.payload_json,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function encodeCursor(input: { createdAt: Date; generationId: string }): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; generationId: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const parsed = JSON.parse(decoded) as { createdAt: string; generationId: string };
  return {
    createdAt: new Date(parsed.createdAt),
    generationId: parsed.generationId,
  };
}

class TxRepository implements RepositoryTx {
  public constructor(private readonly executor: SqlExecutor) {}

  public async createInitialRunBundle(
    input: CreateInitialRunTxInput,
  ): Promise<CreateInitialRunTxResult> {
    const generationInserted = await this.executor.query<GenerationRow>(
      `
      insert into public.generations (user_id, state, refund_state)
      values ($1, 'active', 'none')
      returning *
      `,
      [input.userId],
    );
    const generation = generationInserted.rows[0]!;

    const generationRequestInserted = await this.executor.query<{ id: string }>(
      `
      insert into public.generation_requests (
        generation_id,
        user_id,
        source_text,
        requested_image_count,
        creative_mode,
        controls_json,
        idempotency_key
      ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
      returning id
      `,
      [
        generation.id,
        input.userId,
        input.sourceText,
        input.requestedImageCount,
        input.creativeMode,
        JSON.stringify(input.controlsJson),
        input.idempotencyKey,
      ],
    );

    const runInserted = await this.executor.query<GenerationRunRow>(
      `
      insert into public.generation_runs (
        generation_id,
        user_id,
        generation_request_id,
        run_number,
        run_source,
        pipeline_state,
        requested_image_count,
        correlation_id,
        attempt_count,
        retry_count,
        max_retry_count
      ) values ($1, $2, $3, 1, 'initial', 'queued', $4, $5, 1, 0, 3)
      returning *
      `,
      [
        generation.id,
        input.userId,
        generationRequestInserted.rows[0]!.id,
        input.requestedImageCount,
        input.correlationId,
      ],
    );

    const run = runInserted.rows[0]!;

    await this.executor.query(
      `
      update public.generations
      set active_run_id = $2, updated_at = now()
      where id = $1
      `,
      [generation.id, run.id],
    );

    const creditAccount = await this.executor.query<{ id: string }>(
      `
      select id
      from public.credit_accounts
      where user_id = $1
      `,
      [input.userId],
    );

    if (creditAccount.rows.length === 0) {
      throw new Error("CREDIT_ACCOUNT_NOT_FOUND");
    }

    await this.executor.query(
      `
      insert into public.credit_ledger_entries (
        credit_account_id,
        user_id,
        entry_type,
        reason,
        amount,
        generation_run_id,
        idempotency_key,
        metadata_json
      ) values ($1, $2, 'debit', 'generation_run_debit', $3, $4, $5, $6::jsonb)
      `,
      [
        creditAccount.rows[0]!.id,
        input.userId,
        input.debitAmount,
        run.id,
        `debit:${run.id}`,
        JSON.stringify({ requested_image_count: input.requestedImageCount }),
      ],
    );

    await this.executor.query(
      `
      insert into public.jobs (run_id, queue_state, correlation_id, payload_json)
      values ($1, 'queued', $2, $3::jsonb)
      `,
      [run.id, input.correlationId, JSON.stringify({ source: "initial" })],
    );

    await this.createModerationEvent({
      generationId: generation.id,
      runId: run.id,
      imageVariantId: null,
      userId: input.userId,
      stage: "input_moderation",
      decision: input.inputModerationDecision,
      policyCode: input.inputModerationPolicyCode,
      message: input.inputModerationMessage,
      detailsJson: {
        source: "submit_generation",
      },
    });

    return {
      generationId: generation.id,
      runId: run.id,
    };
  }

  public async createRefineRunBundle(input: CreateRefineRunTxInput): Promise<CreateRefineRunTxResult> {
    const ownership = await this.executor.query<{ id: string }>(
      `
      select id
      from public.generations
      where id = $1 and user_id = $2
      limit 1
      `,
      [input.generationId, input.userId],
    );

    if (ownership.rows.length === 0) {
      throw new Error("GENERATION_OWNERSHIP_VIOLATION");
    }

    const runNumberResult = await this.executor.query<{ next_run_number: number }>(
      `
      select coalesce(max(run_number), 0) + 1 as next_run_number
      from public.generation_runs
      where generation_id = $1
      `,
      [input.generationId],
    );

    const refinementInserted = await this.executor.query<{ id: string }>(
      `
      insert into public.refinement_instructions (
        generation_id,
        user_id,
        based_on_run_id,
        instruction_text,
        controls_delta_json,
        requested_image_count,
        idempotency_key
      ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)
      returning id
      `,
      [
        input.generationId,
        input.userId,
        input.basedOnRunId,
        input.instructionText,
        JSON.stringify(input.controlsDeltaJson),
        input.requestedImageCount,
        input.idempotencyKey,
      ],
    );

    const runInserted = await this.executor.query<GenerationRunRow>(
      `
      insert into public.generation_runs (
        generation_id,
        user_id,
        refinement_instruction_id,
        run_number,
        run_source,
        pipeline_state,
        requested_image_count,
        correlation_id,
        attempt_count,
        retry_count,
        max_retry_count
      ) values ($1, $2, $3, $4, 'refine', 'queued', $5, $6, 1, 0, 3)
      returning *
      `,
      [
        input.generationId,
        input.userId,
        refinementInserted.rows[0]!.id,
        runNumberResult.rows[0]!.next_run_number,
        input.requestedImageCount,
        input.correlationId,
      ],
    );

    const run = runInserted.rows[0]!;

    const creditAccount = await this.executor.query<{ id: string }>(
      `select id from public.credit_accounts where user_id = $1`,
      [input.userId],
    );

    if (creditAccount.rows.length === 0) {
      throw new Error("CREDIT_ACCOUNT_NOT_FOUND");
    }

    await this.executor.query(
      `
      insert into public.credit_ledger_entries (
        credit_account_id,
        user_id,
        entry_type,
        reason,
        amount,
        generation_run_id,
        idempotency_key,
        metadata_json
      ) values ($1, $2, 'debit', 'generation_run_debit', $3, $4, $5, $6::jsonb)
      `,
      [
        creditAccount.rows[0]!.id,
        input.userId,
        input.debitAmount,
        run.id,
        `debit:${run.id}`,
        JSON.stringify({ requested_image_count: input.requestedImageCount, source: "refine" }),
      ],
    );

    await this.executor.query(
      `
      insert into public.jobs (run_id, queue_state, correlation_id, payload_json)
      values ($1, 'queued', $2, $3::jsonb)
      `,
      [run.id, input.correlationId, JSON.stringify({ source: "refine" })],
    );

    await this.createModerationEvent({
      generationId: input.generationId,
      runId: run.id,
      imageVariantId: null,
      userId: input.userId,
      stage: "input_moderation",
      decision: input.inputModerationDecision,
      policyCode: input.inputModerationPolicyCode,
      message: input.inputModerationMessage,
      detailsJson: {
        source: "refine_generation",
      },
    });

    return {
      runId: run.id,
    };
  }

  public async updateGenerationActiveRun(generationId: string, runId: string): Promise<void> {
    await this.executor.query(
      `update public.generations set active_run_id = $2, updated_at = now() where id = $1`,
      [generationId, runId],
    );
  }

  public async updateGenerationState(generationId: string, state: GenerationState): Promise<void> {
    await this.executor.query(
      `update public.generations set state = $2, updated_at = now() where id = $1`,
      [generationId, state],
    );
  }

  public async updateGenerationRefundState(
    generationId: string,
    refundState: "none" | "full_refunded" | "prorata_refunded",
  ): Promise<void> {
    await this.executor.query(
      `update public.generations set refund_state = $2, updated_at = now() where id = $1`,
      [generationId, refundState],
    );
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

    const values: unknown[] = [params.runId, params.from, params.to];
    const sets: string[] = ["pipeline_state = $3", "updated_at = now()"];

    if (params.incrementRetryCount === true) {
      sets.push("retry_count = retry_count + 1");
    }

    if (params.setStartedAt === true) {
      sets.push("started_at = coalesce(started_at, now())");
    }

    if (params.setCompletedAt === true) {
      sets.push("completed_at = now()");
    }

    if (Object.prototype.hasOwnProperty.call(params, "nextRetryAt")) {
      values.push(params.nextRetryAt ?? null);
      sets.push(`next_retry_at = $${values.length}`);
    }

    if (params.terminalReasonCode !== undefined) {
      values.push(params.terminalReasonCode);
      sets.push(`terminal_reason_code = $${values.length}`);
    }

    if (params.terminalReasonMessage !== undefined) {
      values.push(params.terminalReasonMessage);
      sets.push(`terminal_reason_message = $${values.length}`);
    }

    const sql = `
      update public.generation_runs
      set ${sets.join(", ")}
      where id = $1 and pipeline_state = $2
      returning *
    `;

    const result = await this.executor.query<GenerationRunRow>(sql, values);
    if (result.rows.length === 0) {
      throw new Error("RUN_TRANSITION_CONFLICT");
    }
    return mapGenerationRun(result.rows[0]!);
  }

  public async createModerationEvent(params: {
    generationId: string;
    runId: string | null;
    imageVariantId: string | null;
    userId: string;
    stage: "input_moderation" | "pre_generation_shaping" | "output_moderation";
    decision: "allow" | "sanitize" | "soft_block" | "hard_block" | "review";
    policyCode: string;
    message: string | null;
    detailsJson: Record<string, unknown>;
  }): Promise<ModerationEvent> {
    const inserted = await this.executor.query<
      QueryResultRow & {
        id: string;
        generation_id: string;
        run_id: string | null;
        image_variant_id: string | null;
        user_id: string;
        stage: "input_moderation" | "pre_generation_shaping" | "output_moderation";
        decision: "allow" | "sanitize" | "soft_block" | "hard_block" | "review";
        policy_code: string | null;
        message: string | null;
        details_json: Record<string, unknown>;
        created_at: Date;
      }
    >(
      `
      insert into public.moderation_events (
        generation_id,
        run_id,
        image_variant_id,
        user_id,
        stage,
        decision,
        policy_code,
        message,
        details_json
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      returning *
      `,
      [
        params.generationId,
        params.runId,
        params.imageVariantId,
        params.userId,
        params.stage,
        params.decision,
        params.policyCode,
        params.message,
        JSON.stringify(params.detailsJson),
      ],
    );

    const row = inserted.rows[0]!;
    return {
      id: row.id,
      generationId: row.generation_id,
      runId: row.run_id,
      imageVariantId: row.image_variant_id,
      userId: row.user_id,
      stage: row.stage,
      decision: row.decision,
      policyCode: row.policy_code,
      message: row.message,
      detailsJson: row.details_json,
      createdAt: new Date(row.created_at),
    };
  }

  public async createAnalysisArtifacts(input: CreateAnalysisArtifactsInput): Promise<void> {
    await this.executor.query(
      `
      insert into public.user_intents (
        generation_id,
        run_id,
        user_id,
        intent_json,
        model_name,
        confidence
      ) values ($1, $2, $3, $4::jsonb, $5, $6)
      on conflict (run_id)
      do update set
        intent_json = excluded.intent_json,
        model_name = excluded.model_name,
        confidence = excluded.confidence
      `,
      [
        input.generationId,
        input.runId,
        input.userId,
        JSON.stringify(input.userIntent.intentJson),
        input.userIntent.modelName,
        input.userIntent.confidence,
      ],
    );

    await this.executor.query(
      `
      insert into public.emotion_analyses (
        generation_id,
        run_id,
        user_id,
        analysis_json,
        model_name
      ) values ($1, $2, $3, $4::jsonb, $5)
      on conflict (run_id)
      do update set
        analysis_json = excluded.analysis_json,
        model_name = excluded.model_name
      `,
      [
        input.generationId,
        input.runId,
        input.userId,
        JSON.stringify(input.emotionAnalysis.analysisJson),
        input.emotionAnalysis.modelName,
      ],
    );

    for (const direction of input.creativeDirections) {
      await this.executor.query(
        `
        insert into public.creative_directions (
          generation_id,
          run_id,
          user_id,
          direction_index,
          direction_title,
          direction_json
        ) values ($1, $2, $3, $4, $5, $6::jsonb)
        on conflict (run_id, direction_index)
        do update set
          direction_title = excluded.direction_title,
          direction_json = excluded.direction_json
        `,
        [
          input.generationId,
          input.runId,
          input.userId,
          direction.directionIndex,
          direction.directionTitle,
          JSON.stringify(direction.directionJson),
        ],
      );
    }

    let selectedCreativeDirectionId: string | null = null;

    if (input.visualPlan.selectedCreativeDirectionIndex !== null) {
      const selected = await this.executor.query<{ id: string }>(
        `
        select id
        from public.creative_directions
        where run_id = $1 and direction_index = $2
        limit 1
        `,
        [input.runId, input.visualPlan.selectedCreativeDirectionIndex],
      );
      selectedCreativeDirectionId = selected.rows[0]!?.id ?? null;
    }

    await this.executor.query(
      `
      insert into public.visual_plans (
        generation_id,
        run_id,
        user_id,
        selected_creative_direction_id,
        plan_json,
        explainability_json
      ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
      on conflict (run_id)
      do update set
        selected_creative_direction_id = excluded.selected_creative_direction_id,
        plan_json = excluded.plan_json,
        explainability_json = excluded.explainability_json,
        updated_at = now()
      `,
      [
        input.generationId,
        input.runId,
        input.userId,
        selectedCreativeDirectionId,
        JSON.stringify(input.visualPlan.planJson),
        JSON.stringify(input.visualPlan.explainabilityJson),
      ],
    );
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
    await this.executor.query(
      `
      insert into public.provider_payloads (
        generation_id,
        run_id,
        user_id,
        provider_type,
        provider_name,
        request_payload_redacted,
        response_payload_redacted,
        status_code,
        duration_ms
      ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
      `,
      [
        params.generationId,
        params.runId,
        params.userId,
        params.providerType,
        params.providerName,
        JSON.stringify(params.requestPayloadRedacted),
        JSON.stringify(params.responsePayloadRedacted),
        params.statusCode ?? null,
        params.durationMs ?? null,
      ],
    );
  }

  public async insertImageVariants(
    inputs: Parameters<RepositoryTx["insertImageVariants"]>[0],
  ): Promise<ImageVariant[]> {
    const inserted: ImageVariant[] = [];

    for (const variant of inputs) {
      const result = await this.executor.query<ImageVariantRow>(
        `
        insert into public.image_variants (
          generation_id,
          run_id,
          user_id,
          variant_index,
          direction_index,
          status,
          storage_bucket,
          storage_path,
          mime_type,
          width,
          height,
          moderation_decision,
          moderation_reason
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (run_id, variant_index)
        do update set
          direction_index = excluded.direction_index,
          status = excluded.status,
          storage_bucket = excluded.storage_bucket,
          storage_path = excluded.storage_path,
          mime_type = excluded.mime_type,
          width = excluded.width,
          height = excluded.height,
          moderation_decision = excluded.moderation_decision,
          moderation_reason = excluded.moderation_reason,
          updated_at = now()
        returning *
        `,
        [
          variant.generationId,
          variant.runId,
          variant.userId,
          variant.variantIndex,
          variant.directionIndex,
          variant.status,
          variant.storageBucket,
          variant.storagePath,
          variant.mimeType,
          variant.width,
          variant.height,
          variant.moderationDecision,
          variant.moderationReason,
        ],
      );

      inserted.push(mapImageVariant(result.rows[0]!));
    }

    return inserted;
  }

  public async getRunById(runId: string): Promise<GenerationRun | null> {
    const result = await this.executor.query<GenerationRunRow>(
      `select * from public.generation_runs where id = $1 limit 1`,
      [runId],
    );
    return result.rows.length === 0 ? null : mapGenerationRun(result.rows[0]!);
  }

  public async getJobByRunId(runId: string): Promise<Job | null> {
    const result = await this.executor.query<JobRow>(
      `select * from public.jobs where run_id = $1 limit 1`,
      [runId],
    );
    return result.rows.length === 0 ? null : mapJob(result.rows[0]!);
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
    const inserted = await this.executor.query<{ id: string }>(
      `
      insert into public.credit_ledger_entries (
        credit_account_id,
        user_id,
        entry_type,
        reason,
        amount,
        generation_run_id,
        idempotency_key,
        metadata_json
      ) values ($1, $2, 'refund', $3, $4, $5, $6, $7::jsonb)
      on conflict (idempotency_key) do nothing
      returning id
      `,
      [
        params.creditAccountId,
        params.userId,
        params.reason,
        params.amount,
        params.generationRunId,
        params.idempotencyKey,
        JSON.stringify(params.metadataJson),
      ],
    );

    return inserted.rows.length > 0;
  }

  public async updateRunRefundAmount(runId: string, refundAmount: number): Promise<void> {
    await this.executor.query(
      `update public.generation_runs set refund_amount = $2, updated_at = now() where id = $1`,
      [runId, refundAmount],
    );
  }
}

export class PostgresRepository implements Repository {
  public constructor(private readonly client: PostgresClient) {}

  public async withTransaction<T>(callback: (tx: RepositoryTx) => Promise<T>): Promise<T> {
    return this.client.transaction(async (pgClient: PoolClient) => {
      const tx = new TxRepository(pgClient);
      return callback(tx);
    });
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
    const result = await this.client.query<
      QueryResultRow & {
        generation_id: string;
        run_id: string;
        source_text: string;
        requested_image_count: number;
        creative_mode: "fast" | "balanced" | "directed";
        controls_json: Record<string, unknown>;
      }
    >(
      `
      select
        gr.generation_id,
        r.id as run_id,
        gr.source_text,
        gr.requested_image_count,
        gr.creative_mode,
        gr.controls_json
      from public.generation_requests gr
      join public.generation_runs r
        on r.generation_request_id = gr.id
      where gr.user_id = $1 and gr.idempotency_key = $2
      order by r.created_at asc
      limit 1
      `,
      [userId, idempotencyKey],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0]!;
    return {
      generationId: row.generation_id,
      runId: row.run_id,
      sourceText: row.source_text,
      requestedImageCount: row.requested_image_count,
      creativeMode: row.creative_mode,
      controlsJson: row.controls_json,
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
    const result = await this.client.query<
      QueryResultRow & {
        generation_id: string;
        run_id: string;
        based_on_run_id: string | null;
        instruction_text: string;
        requested_image_count: number;
        controls_delta_json: Record<string, unknown>;
      }
    >(
      `
      select
        ri.generation_id,
        r.id as run_id,
        ri.based_on_run_id,
        ri.instruction_text,
        ri.requested_image_count,
        ri.controls_delta_json
      from public.refinement_instructions ri
      join public.generation_runs r
        on r.refinement_instruction_id = ri.id
      where ri.user_id = $1 and ri.idempotency_key = $2
      order by r.created_at asc
      limit 1
      `,
      [userId, idempotencyKey],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0]!;
    return {
      generationId: row.generation_id,
      runId: row.run_id,
      basedOnRunId: row.based_on_run_id,
      instructionText: row.instruction_text,
      requestedImageCount: row.requested_image_count,
      controlsDeltaJson: row.controls_delta_json,
    };
  }

  public async getCreditBalance(
    userId: string,
  ): Promise<{ creditAccountId: string; balance: number } | null> {
    const result = await this.client.query<
      QueryResultRow & { id: string; balance: number }
    >(
      `
      select id, balance
      from public.credit_accounts
      where user_id = $1
      limit 1
      `,
      [userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      creditAccountId: result.rows[0]!.id,
      balance: result.rows[0]!.balance,
    };
  }

  public async getGenerationDetailForUser(
    generationId: string,
    userId: string,
  ): Promise<RunDetailAggregate | null> {
    const generationResult = await this.client.query<GenerationRow>(
      `
      select *
      from public.generations
      where id = $1 and user_id = $2
      limit 1
      `,
      [generationId, userId],
    );

    if (generationResult.rows.length === 0) {
      return null;
    }

    const generation = mapGeneration(generationResult.rows[0]!);

    const runRows = await this.client.query<GenerationRunRow>(
      `
      select *
      from public.generation_runs
      where generation_id = $1 and user_id = $2
      order by created_at desc
      `,
      [generationId, userId],
    );

    const runs = runRows.rows.map(mapGenerationRun);

    const activeRun = generation.activeRunId
      ? runs.find((run) => run.id === generation.activeRunId) ?? null
      : null;

    const variantRows = await this.client.query<ImageVariantRow>(
      `
      select *
      from public.image_variants
      where generation_id = $1 and user_id = $2
      order by created_at desc, variant_index asc
      `,
      [generationId, userId],
    );

    return {
      generation,
      activeRun,
      runs,
      variants: variantRows.rows.map(mapImageVariant),
    };
  }

  public async getGenerationDetailForService(
    generationId: string,
  ): Promise<RunDetailAggregate | null> {
    const generationResult = await this.client.query<GenerationRow>(
      `
      select *
      from public.generations
      where id = $1
      limit 1
      `,
      [generationId],
    );

    if (generationResult.rows.length === 0) {
      return null;
    }

    const generation = mapGeneration(generationResult.rows[0]!);

    const runRows = await this.client.query<GenerationRunRow>(
      `
      select *
      from public.generation_runs
      where generation_id = $1
      order by created_at desc
      `,
      [generationId],
    );

    const runs = runRows.rows.map(mapGenerationRun);

    const activeRun = generation.activeRunId
      ? runs.find((run) => run.id === generation.activeRunId) ?? null
      : null;

    const variantRows = await this.client.query<ImageVariantRow>(
      `
      select *
      from public.image_variants
      where generation_id = $1
      order by created_at desc, variant_index asc
      `,
      [generationId],
    );

    return {
      generation,
      activeRun,
      runs,
      variants: variantRows.rows.map(mapImageVariant),
    };
  }

  public async listGenerationHistoryForUser(params: {
    userId: string;
    limit: number;
    cursor: string | null;
  }): Promise<GenerationHistoryPage> {
    const values: unknown[] = [params.userId, params.limit + 1];
    let cursorClause = "";

    if (params.cursor !== null) {
      const decoded = decodeCursor(params.cursor);
      values.push(decoded.createdAt);
      values.push(decoded.generationId);
      cursorClause = `
        and (created_at, generation_id) < ($3::timestamptz, $4::uuid)
      `;
    }

    const rows = await this.client.query<
      QueryResultRow & {
        generation_id: string;
        active_run_state: GenerationRun["pipelineState"];
        created_at: Date;
        latest_variant_thumbnail_path: string | null;
        total_runs: number;
      }
    >(
      `
      select generation_id, active_run_state, created_at, latest_variant_thumbnail_path, total_runs
      from public.v_generation_history
      where user_id = $1
      ${cursorClause}
      order by created_at desc, generation_id desc
      limit $2
      `,
      values,
    );

    const hasMore = rows.rows.length > params.limit;
    const sliced = hasMore ? rows.rows.slice(0, params.limit) : rows.rows;

    const items: GenerationHistoryRow[] = sliced.map((row) => ({
      generationId: row.generation_id,
      activeRunState: row.active_run_state,
      createdAt: new Date(row.created_at),
      latestVariantThumbnailPath: row.latest_variant_thumbnail_path,
      totalRuns: row.total_runs,
    }));

    const lastItem = items.length > 0 ? items[items.length - 1]! : null;
    const nextCursor =
      hasMore && lastItem !== null
        ? encodeCursor({
            createdAt: lastItem.createdAt,
            generationId: lastItem.generationId,
          })
        : null;

    return {
      items,
      nextCursor,
    };
  }

  public async getRunExecutionContext(runId: string): Promise<RunExecutionContext | null> {
    const result = await this.client.query<
      QueryResultRow & {
        generation_id: string;
        generation_user_id: string;
        generation_state: Generation["state"];
        generation_refund_state: Generation["refundState"];
        active_run_id: string | null;
        generation_created_at: Date;
        generation_updated_at: Date;
        run_id: string;
        run_user_id: string;
        generation_request_id: string | null;
        refinement_instruction_id: string | null;
        run_number: number;
        run_source: "initial" | "refine";
        pipeline_state: GenerationRun["pipelineState"];
        requested_image_count: number;
        correlation_id: string;
        attempt_count: number;
        retry_count: number;
        max_retry_count: number;
        next_retry_at: Date | null;
        started_at: Date | null;
        completed_at: Date | null;
        terminal_reason_code: string | null;
        terminal_reason_message: string | null;
        refund_amount: number;
        run_created_at: Date;
        run_updated_at: Date;
        source_text: string | null;
        creative_mode: "fast" | "balanced" | "directed" | null;
        instruction_text: string | null;
      }
    >(
      `
      select
        g.id as generation_id,
        g.user_id as generation_user_id,
        g.state as generation_state,
        g.refund_state as generation_refund_state,
        g.active_run_id,
        g.created_at as generation_created_at,
        g.updated_at as generation_updated_at,
        r.id as run_id,
        r.user_id as run_user_id,
        r.generation_request_id,
        r.refinement_instruction_id,
        r.run_number,
        r.run_source,
        r.pipeline_state,
        r.requested_image_count,
        r.correlation_id,
        r.attempt_count,
        r.retry_count,
        r.max_retry_count,
        r.next_retry_at,
        r.started_at,
        r.completed_at,
        r.terminal_reason_code,
        r.terminal_reason_message,
        r.refund_amount,
        r.created_at as run_created_at,
        r.updated_at as run_updated_at,
        gr.source_text,
        gr.creative_mode,
        ri.instruction_text
      from public.generation_runs r
      join public.generations g
        on g.id = r.generation_id
      left join public.generation_requests gr
        on gr.id = r.generation_request_id
      left join public.refinement_instructions ri
        on ri.id = r.refinement_instruction_id
      where r.id = $1
      limit 1
      `,
      [runId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0]!;

    const generation: Generation = {
      id: row.generation_id,
      userId: row.generation_user_id,
      state: row.generation_state,
      refundState: row.generation_refund_state,
      activeRunId: row.active_run_id,
      createdAt: new Date(row.generation_created_at),
      updatedAt: new Date(row.generation_updated_at),
    };

    const run: GenerationRun = {
      id: row.run_id,
      generationId: row.generation_id,
      userId: row.run_user_id,
      generationRequestId: row.generation_request_id,
      refinementInstructionId: row.refinement_instruction_id,
      runNumber: row.run_number,
      runSource: row.run_source,
      pipelineState: row.pipeline_state,
      requestedImageCount: row.requested_image_count,
      correlationId: row.correlation_id,
      attemptCount: row.attempt_count,
      retryCount: row.retry_count,
      maxRetryCount: row.max_retry_count,
      nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at) : null,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      terminalReasonCode: row.terminal_reason_code,
      terminalReasonMessage: row.terminal_reason_message,
      refundAmount: row.refund_amount,
      createdAt: new Date(row.run_created_at),
      updatedAt: new Date(row.run_updated_at),
    };

    return {
      generation,
      run,
      generationRequestSourceText: row.source_text,
      generationRequestCreativeMode: row.creative_mode,
      refinementInstructionText: row.instruction_text,
    };
  }

  public async countCompletedVariantsByRun(runId: string): Promise<number> {
    const result = await this.client.query<{ count: string }>(
      `
      select count(*)::text as count
      from public.image_variants
      where run_id = $1 and status = 'completed'
      `,
      [runId],
    );
    return Number.parseInt(result.rows[0]!?.count ?? "0", 10);
  }

  public async getDebitLedgerAmountByRun(runId: string): Promise<number | null> {
    const result = await this.client.query<{ amount: number }>(
      `
      select amount
      from public.credit_ledger_entries
      where generation_run_id = $1 and reason = 'generation_run_debit'
      order by created_at asc
      limit 1
      `,
      [runId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0]!.amount;
  }

  public async leaseNextJob(params: {
    leaseSeconds: number;
    now: Date;
  }): Promise<Job | null> {
    const leaseExpiresAt = new Date(params.now.getTime() + params.leaseSeconds * 1000);

    const leased = await this.client.transaction(async (executor) => {
      const result = await executor.query<JobRow>(
        `
        with candidate as (
          select id
          from public.jobs
          where queue_state in ('queued', 'retry_wait')
            and (next_retry_at is null or next_retry_at <= $1)
            and (
              leased_at is null
              or lease_expires_at is null
              or lease_expires_at <= $1
            )
          order by created_at asc
          limit 1
          for update skip locked
        )
        update public.jobs j
        set
          queue_state = 'leased',
          leased_at = $1,
          lease_expires_at = $2,
          updated_at = now()
        from candidate
        where j.id = candidate.id
        returning j.*
        `,
        [params.now, leaseExpiresAt],
      );

      return result.rows[0]! ?? null;
    });

    return leased ? mapJob(leased) : null;
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
    if (!canTransitionJob(params.from, params.to) && params.from !== params.to) {
      throw new Error(`ILLEGAL_JOB_TRANSITION:${params.from}->${params.to}`);
    }

    const values: unknown[] = [params.jobId, params.from, params.to];
    const sets: string[] = ["queue_state = $3", "updated_at = now()"];

    if (params.retryCount !== undefined) {
      values.push(params.retryCount);
      sets.push(`retry_count = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(params, "nextRetryAt")) {
      values.push(params.nextRetryAt ?? null);
      sets.push(`next_retry_at = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(params, "lastErrorCode")) {
      values.push(params.lastErrorCode ?? null);
      sets.push(`last_error_code = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(params, "lastErrorMessage")) {
      values.push(params.lastErrorMessage ?? null);
      sets.push(`last_error_message = $${values.length}`);
    }

    if (params.to === "completed") {
      sets.push("completed_at = now()");
    }
    if (params.to === "failed") {
      sets.push("failed_at = now()");
    }
    if (params.to === "cancelled") {
      sets.push("cancelled_at = now()");
    }
    if (params.to === "dead_letter") {
      sets.push("dead_lettered_at = now()");
    }

    const sql = `
      update public.jobs
      set ${sets.join(", ")}
      where id = $1 and queue_state = $2
      returning *
    `;

    const updated = await this.client.query<JobRow>(sql, values);
    return updated.rows.length === 0 ? null : mapJob(updated.rows[0]!);
  }

  public async getRunById(runId: string): Promise<GenerationRun | null> {
    const result = await this.client.query<GenerationRunRow>(
      `select * from public.generation_runs where id = $1 limit 1`,
      [runId],
    );

    return result.rows.length === 0 ? null : mapGenerationRun(result.rows[0]!);
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
    const debitSince = new Date(params.now.getTime() - 24 * 60 * 60 * 1000);
    const runSince = new Date(params.now.getTime() - 10 * 60 * 1000);
    const blockSince = new Date(params.now.getTime() - 30 * 60 * 1000);

    const result = await this.client.query<
      QueryResultRow & {
        generation_debit_credits_last_24h: string;
        generation_runs_last_10m: string;
        refine_runs_last_10m: string;
        hard_blocks_last_30m: string;
      }
    >(
      `
      select
        (
          select coalesce(sum(-cle.amount), 0)::text
          from public.credit_ledger_entries cle
          where cle.user_id = $1
            and cle.reason = 'generation_run_debit'
            and cle.amount < 0
            and cle.created_at >= $2
        ) as generation_debit_credits_last_24h,
        (
          select count(*)::text
          from public.generation_runs gr
          where gr.user_id = $1
            and gr.created_at >= $3
        ) as generation_runs_last_10m,
        (
          select count(*)::text
          from public.generation_runs gr
          where gr.user_id = $1
            and gr.run_source = 'refine'
            and gr.created_at >= $3
        ) as refine_runs_last_10m,
        (
          select count(*)::text
          from public.moderation_events me
          where me.user_id = $1
            and me.stage = 'input_moderation'
            and me.decision = 'hard_block'
            and me.created_at >= $4
        ) as hard_blocks_last_30m
      `,
      [params.userId, debitSince, runSince, blockSince],
    );

    const row = result.rows[0]!;
    return {
      generationDebitCreditsLast24h: Number.parseInt(row.generation_debit_credits_last_24h, 10),
      generationRunsLast10m: Number.parseInt(row.generation_runs_last_10m, 10),
      refineRunsLast10m: Number.parseInt(row.refine_runs_last_10m, 10),
      hardBlocksLast30m: Number.parseInt(row.hard_blocks_last_30m, 10),
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
    const staleSince = new Date(params.now.getTime() - params.staleSeconds * 1000);

    const result = await this.client.query<
      QueryResultRow & {
        queued_count: string;
        retry_wait_count: string;
        leased_count: string;
        running_count: string;
        dead_letter_count: string;
        failed_count: string;
        oldest_queued_at: Date | null;
        stale_leased_count: string;
        stale_running_count: string;
      }
    >(
      `
      select
        count(*) filter (where queue_state = 'queued')::text as queued_count,
        count(*) filter (where queue_state = 'retry_wait')::text as retry_wait_count,
        count(*) filter (where queue_state = 'leased')::text as leased_count,
        count(*) filter (where queue_state = 'running')::text as running_count,
        count(*) filter (where queue_state = 'dead_letter')::text as dead_letter_count,
        count(*) filter (where queue_state = 'failed')::text as failed_count,
        min(created_at) filter (where queue_state in ('queued', 'retry_wait')) as oldest_queued_at,
        count(*) filter (
          where queue_state = 'leased'
            and lease_expires_at is not null
            and lease_expires_at <= $1
        )::text as stale_leased_count,
        count(*) filter (
          where queue_state = 'running'
            and updated_at <= $2
        )::text as stale_running_count
      from public.jobs
      `,
      [params.now, staleSince],
    );

    const row = result.rows[0]!;
    return {
      queuedCount: Number.parseInt(row.queued_count, 10),
      retryWaitCount: Number.parseInt(row.retry_wait_count, 10),
      leasedCount: Number.parseInt(row.leased_count, 10),
      runningCount: Number.parseInt(row.running_count, 10),
      deadLetterCount: Number.parseInt(row.dead_letter_count, 10),
      failedCount: Number.parseInt(row.failed_count, 10),
      oldestQueuedAt: row.oldest_queued_at ? new Date(row.oldest_queued_at) : null,
      staleLeasedCount: Number.parseInt(row.stale_leased_count, 10),
      staleRunningCount: Number.parseInt(row.stale_running_count, 10),
    };
  }
}

export function createPostgresRepository(connectionString: string): PostgresRepository {
  const client = new PostgresClient(connectionString);
  return new PostgresRepository(client);
}
