import type {
  GenerationVisibilityUpdateRequestDto,
  GenerationVisibilityUpdateResponseDto,
} from "@vi/contracts";
import { NotFoundAppError, ValidationAppError } from "../errors";
import type { Logger } from "../ports/observability";
import type { Repository } from "../ports/repositories";

export interface UpdateGenerationVisibilityInput {
  generationId: string;
  userId: string;
  payload: GenerationVisibilityUpdateRequestDto;
  requestId: string;
}

export class UpdateGenerationVisibilityUseCase {
  public constructor(
    private readonly repository: Repository,
    private readonly logger: Logger,
  ) {}

  public async execute(
    input: UpdateGenerationVisibilityInput,
  ): Promise<GenerationVisibilityUpdateResponseDto> {
    const aggregate = await this.repository.getGenerationDetailForUser(
      input.generationId,
      input.userId,
    );
    if (aggregate === null) {
      throw new NotFoundAppError("Generation");
    }

    const featuredVariantId = input.payload.featured_variant_id === undefined
      ? aggregate.generation.featuredVariantId
      : input.payload.featured_variant_id;

    if (featuredVariantId !== null) {
      const allowed = aggregate.variants.some(
        (variant) =>
          variant.id === featuredVariantId &&
          variant.userId === input.userId &&
          variant.status === "completed",
      );

      if (!allowed) {
        throw new ValidationAppError("featured_variant_id generation sahibine ait completed variant olmalı.");
      }
    }

    const updated = await this.repository.updateGenerationVisibilityForUser({
      generationId: input.generationId,
      userId: input.userId,
      visibility: input.payload.visibility,
      featuredVariantId,
    });

    if (updated === null) {
      throw new NotFoundAppError("Generation");
    }

    this.logger.info("generation_visibility_updated", {
      requestId: input.requestId,
      userId: input.userId,
      generationId: input.generationId,
      visibility: updated.visibility,
      shareSlug: updated.shareSlug,
      featuredVariantId: updated.featuredVariantId,
    });

    return {
      generation_id: updated.id,
      visibility: updated.visibility,
      share_slug: updated.shareSlug,
      share_path: `/share/${updated.shareSlug}`,
      published_at: updated.publishedAt?.toISOString() ?? null,
      featured_variant_id: updated.featuredVariantId,
      request_id: input.requestId,
    };
  }
}
