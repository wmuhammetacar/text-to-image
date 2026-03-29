import type {
  GenerationDetailResponseDto,
  GenerationHistoryItemDto,
} from "@vi/contracts";
import { NotFoundAppError } from "../errors";
import type { Logger } from "../ports/observability";
import type { Repository } from "../ports/repositories";

export interface AssetSigner {
  sign(params: {
    bucket: string;
    path: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }>;
}

export class GetGenerationDetailUseCase {
  public constructor(
    private readonly repository: Repository,
    private readonly assetSigner: AssetSigner,
    private readonly logger: Logger,
    private readonly fullImageTtlSeconds: number,
    private readonly thumbnailTtlSeconds: number,
    private readonly creditCostPerImage: number,
    private readonly imageStorageBucket: string,
  ) {}

  public async execute(input: {
    generationId: string;
    userId: string;
    requestId: string;
  }): Promise<GenerationDetailResponseDto> {
    const aggregate = await this.repository.getGenerationDetailForUser(
      input.generationId,
      input.userId,
    );

    if (aggregate === null) {
      throw new NotFoundAppError("Generation");
    }

    const activeRunState = aggregate.activeRun?.pipelineState ?? "queued";

    const variants = await Promise.all(
      aggregate.variants.map(async (variant) => {
        if (variant.status !== "completed") {
          return {
            image_variant_id: variant.id,
            run_id: variant.runId,
            variant_index: variant.variantIndex,
            status: variant.status,
            signed_url: null,
            expires_at: null,
          };
        }

        try {
          const signed = await this.assetSigner.sign({
            bucket: variant.storageBucket,
            path: variant.storagePath,
            expiresInSeconds: this.fullImageTtlSeconds,
          });

          return {
            image_variant_id: variant.id,
            run_id: variant.runId,
            variant_index: variant.variantIndex,
            status: variant.status,
            signed_url: signed.url,
            expires_at: signed.expiresAt.toISOString(),
          };
        } catch (error) {
          this.logger.warn("generation_variant_signed_url_failed", {
            requestId: input.requestId,
            generationId: input.generationId,
            runId: variant.runId,
            variantId: variant.id,
            bucket: variant.storageBucket,
            path: variant.storagePath,
            error: error instanceof Error ? error.message : "UNKNOWN_SIGN_ERROR",
          });

          return {
            image_variant_id: variant.id,
            run_id: variant.runId,
            variant_index: variant.variantIndex,
            status: variant.status,
            signed_url: null,
            expires_at: null,
          };
        }
      }),
    );

    this.logger.info("generation_detail_fetched", {
      requestId: input.requestId,
      userId: input.userId,
      generationId: input.generationId,
      activeRunState,
    });

    return {
      generation_id: aggregate.generation.id,
      generation_state: aggregate.generation.state,
      active_run_id: aggregate.generation.activeRunId,
      active_run_state: activeRunState,
      runs: aggregate.runs.map((run) => ({
        run_id: run.id,
        pipeline_state: run.pipelineState,
        attempt: run.attemptCount,
        created_at: run.createdAt.toISOString(),
        completed_at: run.completedAt?.toISOString() ?? null,
        refund_state: run.refundAmount <= 0
          ? "none"
          : run.refundAmount >= run.requestedImageCount * this.creditCostPerImage
            ? "full_refunded"
            : "prorata_refunded",
      })),
      variants,
      request_id: input.requestId,
      correlation_id: aggregate.activeRun?.correlationId ?? null,
    };
  }

  public async list(input: {
    userId: string;
    limit: number;
    cursor: string | null;
    requestId: string;
  }): Promise<{ items: GenerationHistoryItemDto[]; next_cursor: string | null; request_id: string }> {
    const page = await this.repository.listGenerationHistoryForUser({
      userId: input.userId,
      limit: input.limit,
      cursor: input.cursor,
    });

    const items = await Promise.all(
      page.items.map(async (item) => {
        let thumbnailUrl: string | null = null;

        if (item.latestVariantThumbnailPath !== null) {
          try {
            const signed = await this.assetSigner.sign({
              bucket: this.imageStorageBucket,
              path: item.latestVariantThumbnailPath,
              expiresInSeconds: this.thumbnailTtlSeconds,
            });
            thumbnailUrl = signed.url;
          } catch (error) {
            this.logger.warn("generation_history_thumbnail_signed_url_failed", {
              requestId: input.requestId,
              userId: input.userId,
              generationId: item.generationId,
              bucket: this.imageStorageBucket,
              path: item.latestVariantThumbnailPath,
              error: error instanceof Error ? error.message : "UNKNOWN_SIGN_ERROR",
            });
            thumbnailUrl = null;
          }
        }

        return {
          generation_id: item.generationId,
          active_run_state: item.activeRunState,
          created_at: item.createdAt.toISOString(),
          latest_variant_thumbnail_url: thumbnailUrl,
          total_runs: item.totalRuns,
        };
      }),
    );

    return {
      items,
      next_cursor: page.nextCursor,
      request_id: input.requestId,
    };
  }
}
