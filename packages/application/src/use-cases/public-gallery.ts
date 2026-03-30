import type {
  PublicGalleryQueryDto,
  PublicGalleryResponseDto,
  PublicGenerationDetailResponseDto,
} from "@vi/contracts";
import type { AssetSigner } from "./get-generation-detail";
import { NotFoundAppError } from "../errors";
import type { Logger } from "../ports/observability";
import type { PublicGalleryRow, Repository } from "../ports/repositories";

type GallerySort = NonNullable<PublicGalleryQueryDto["sort"]>;
type GalleryFilter = NonNullable<PublicGalleryQueryDto["filter"]>;
type GalleryItem = PublicGalleryResponseDto["items"][number];

interface DiscoveryScores {
  qualityScore: number;
  trendingScore: number;
  remixSignal: number;
  recencyScore: number;
  cinematicSignal: number;
  surrealSignal: number;
}

interface DecoratedGalleryItem {
  item: GalleryItem;
  scores: DiscoveryScores;
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function clamp100(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return Number(value.toFixed(2));
}

function hasStyleTag(item: Pick<GalleryItem, "style_tags">, needle: string): boolean {
  const normalizedNeedle = normalizeTag(needle);
  return item.style_tags.some((tag) => normalizeTag(tag).includes(normalizedNeedle));
}

function calculateDiscoveryScores(params: {
  item: GalleryItem;
  now: Date;
}): DiscoveryScores {
  const { item, now } = params;

  const cinematicSignal = hasStyleTag(item, "cinematic") ? 1 : 0;
  const surrealSignal = hasStyleTag(item, "surreal") ? 1 : 0;

  const runSignal = Math.min(item.total_runs, 8) / 8;
  const variationSignal = Math.min(item.variation_count, 10) / 10;
  const refinementSignal = Math.min(item.refinement_count, 8) / 8;
  const remixSignalRaw = Math.min(item.remix_count, 20) / 20;
  const branchSignal = Math.min(item.branch_count, 24) / 24;
  const variantSignal = Math.min(item.total_public_variants, 8) / 8;
  const creatorSignal = Math.min(item.creator_public_generation_count, 30) / 30;

  const qualityScoreRaw =
    runSignal * 14 +
    variationSignal * 14 +
    refinementSignal * 12 +
    remixSignalRaw * 18 +
    branchSignal * 10 +
    variantSignal * 12 +
    creatorSignal * 10 +
    cinematicSignal * 5 +
    surrealSignal * 5;
  const qualityScore = clamp100(qualityScoreRaw);

  const publishedAt = Date.parse(item.published_at);
  const ageDays = Math.max(0, (now.getTime() - publishedAt) / 86_400_000);
  const recencyScore = clamp01(1 - ageDays / 14);
  const remixSignal = clamp01(
    Math.min(item.remix_count * 2 + item.branch_count + item.variation_count, 48) / 48,
  );

  const trendingScore = clamp100(
    (qualityScore / 100) * 42 +
      remixSignal * 38 +
      recencyScore * 20,
  );

  return {
    qualityScore,
    trendingScore,
    remixSignal,
    recencyScore,
    cinematicSignal,
    surrealSignal,
  };
}

function tieBreakGallery(a: GalleryItem, b: GalleryItem): number {
  const publishedDiff = Date.parse(b.published_at) - Date.parse(a.published_at);
  if (publishedDiff !== 0) {
    return publishedDiff;
  }
  return b.generation_id.localeCompare(a.generation_id);
}

function decorateSortReason(params: {
  sort: GallerySort;
  item: GalleryItem;
  scores: DiscoveryScores;
}): string {
  const { sort, item, scores } = params;

  if (sort === "newest") {
    return `En yeni yayınlanan içerik (${new Date(item.published_at).toLocaleDateString("tr-TR")}).`;
  }
  if (sort === "trending") {
    return `Trending skoru yüksek: trend ${scores.trendingScore.toFixed(1)} / kalite ${scores.qualityScore.toFixed(1)}.`;
  }
  if (sort === "most_remixed") {
    return `Remix etkisi güçlü: remix ${item.remix_count}, branch ${item.branch_count}.`;
  }
  if (sort === "most_refined") {
    return `Refine yoğunluğu yüksek: ${item.refinement_count} refine.`;
  }
  if (sort === "most_varied") {
    return `Varyasyon yoğunluğu yüksek: ${item.variation_count} varyasyon.`;
  }
  if (sort === "most_cinematic") {
    return "Cinematic stil sinyali ve kalite skoru öne çıktı.";
  }
  if (sort === "most_surreal") {
    return "Surreal stil sinyali ve kalite skoru öne çıktı.";
  }
  return `Kalite skoru yüksek: ${scores.qualityScore.toFixed(1)}.`;
}

function getDiscoveryBadges(params: {
  item: GalleryItem;
  scores: DiscoveryScores;
}): string[] {
  const { item, scores } = params;
  const badges: string[] = [];

  if (scores.qualityScore >= 72) {
    badges.push("high_quality");
  }
  if (scores.trendingScore >= 65) {
    badges.push("trending");
  }
  if (item.remix_count >= 5 || item.branch_count >= 8) {
    badges.push("remix_hot");
  }
  if (scores.cinematicSignal === 1) {
    badges.push("cinematic");
  }
  if (scores.surrealSignal === 1) {
    badges.push("surreal");
  }
  if (badges.length === 0) {
    badges.push("fresh_pick");
  }

  return badges;
}

function matchesDiscoveryFilter(params: {
  filter: GalleryFilter;
  item: GalleryItem;
  scores: DiscoveryScores;
}): boolean {
  const { filter, item, scores } = params;
  if (filter === "all") {
    return true;
  }
  if (filter === "high_quality") {
    return scores.qualityScore >= 70;
  }
  if (filter === "high_remix") {
    return item.remix_count >= 3 || item.branch_count >= 5;
  }
  if (filter === "cinematic") {
    return scores.cinematicSignal === 1;
  }
  return scores.surrealSignal === 1;
}

function sortDecoratedItems(
  items: DecoratedGalleryItem[],
  sort: GallerySort,
): DecoratedGalleryItem[] {
  const sorted = items.slice();
  sorted.sort((left, right) => {
    const a = left.item;
    const b = right.item;
    const as = left.scores;
    const bs = right.scores;

    if (sort === "trending" && bs.trendingScore !== as.trendingScore) {
      return bs.trendingScore - as.trendingScore;
    }

    if (sort === "most_remixed") {
      if (b.remix_count !== a.remix_count) {
        return b.remix_count - a.remix_count;
      }
      if (b.branch_count !== a.branch_count) {
        return b.branch_count - a.branch_count;
      }
      if (bs.trendingScore !== as.trendingScore) {
        return bs.trendingScore - as.trendingScore;
      }
    }

    if (sort === "most_refined") {
      if (b.refinement_count !== a.refinement_count) {
        return b.refinement_count - a.refinement_count;
      }
      if (b.variation_count !== a.variation_count) {
        return b.variation_count - a.variation_count;
      }
      if (bs.qualityScore !== as.qualityScore) {
        return bs.qualityScore - as.qualityScore;
      }
    }

    if (sort === "most_varied") {
      if (b.variation_count !== a.variation_count) {
        return b.variation_count - a.variation_count;
      }
      if (b.remix_count !== a.remix_count) {
        return b.remix_count - a.remix_count;
      }
    }

    if (sort === "most_cinematic") {
      if (bs.cinematicSignal !== as.cinematicSignal) {
        return bs.cinematicSignal - as.cinematicSignal;
      }
      if (bs.qualityScore !== as.qualityScore) {
        return bs.qualityScore - as.qualityScore;
      }
    }

    if (sort === "most_surreal") {
      if (bs.surrealSignal !== as.surrealSignal) {
        return bs.surrealSignal - as.surrealSignal;
      }
      if (bs.qualityScore !== as.qualityScore) {
        return bs.qualityScore - as.qualityScore;
      }
    }

    if (sort === "best_quality" && bs.qualityScore !== as.qualityScore) {
      return bs.qualityScore - as.qualityScore;
    }

    return tieBreakGallery(a, b);
  });
  return sorted;
}

function mapGalleryRowToItem(params: {
  row: PublicGalleryRow;
  featuredImageUrl: string | null;
}): GalleryItem {
  const { row, featuredImageUrl } = params;
  return {
    generation_id: row.generationId,
    share_slug: row.shareSlug,
    visibility: row.visibility,
    published_at: row.publishedAt.toISOString(),
    creator_display_name: row.creatorDisplayName,
    creator_profile_handle: row.creatorProfileHandle,
    summary: row.summary,
    style_tags: row.styleTags,
    mood_tags: row.moodTags,
    featured_image_url: featuredImageUrl,
    total_runs: row.totalRuns,
    variation_count: row.variationCount,
    refinement_count: row.refinementCount,
    remix_count: row.remixCount,
    branch_count: row.branchCount,
    total_public_variants: row.totalPublicVariants,
    creator_public_generation_count: row.creatorPublicGenerationCount,
    quality_score: 0,
    ranking_score: 0,
    sort_reason: "",
    featured: false,
    discovery_badges: [],
  };
}

export class PublicGalleryUseCase {
  public constructor(
    private readonly repository: Repository,
    private readonly assetSigner: AssetSigner,
    private readonly logger: Logger,
    private readonly fullImageTtlSeconds: number,
    private readonly thumbnailTtlSeconds: number,
    private readonly imageStorageBucket: string,
  ) {}

  public async list(input: {
    query: PublicGalleryQueryDto;
    requestId: string;
  }): Promise<PublicGalleryResponseDto> {
    const sort = input.query.sort ?? "newest";
    const filter = input.query.filter ?? "all";
    const tagFilter = input.query.tag ? normalizeTag(input.query.tag) : null;
    const limit = input.query.limit ?? 20;
    this.logger.info("gallery_opened", {
      requestId: input.requestId,
      sort,
      filter,
      tagFilter,
      limit,
    });

    const repositoryLimit = sort === "newest" && filter === "all" && tagFilter === null
      ? limit
      : Math.max(limit, 120);

    const raw = await this.repository.listPublicGallery({
      limit: repositoryLimit,
      cursor: input.query.cursor ?? null,
    });

    const signedItems = await Promise.all(
      raw.items.map(async (row) => {
        let featuredImageUrl: string | null = null;
        if (row.featuredImagePath !== null) {
          try {
            const signed = await this.assetSigner.sign({
              bucket: this.imageStorageBucket,
              path: row.featuredImagePath,
              expiresInSeconds: this.thumbnailTtlSeconds,
            });
            featuredImageUrl = signed.url;
          } catch (error) {
            this.logger.warn("public_gallery_featured_sign_failed", {
              requestId: input.requestId,
              generationId: row.generationId,
              path: row.featuredImagePath,
              error: error instanceof Error ? error.message : "UNKNOWN_SIGN_ERROR",
            });
          }
        }

        return mapGalleryRowToItem({
          row,
          featuredImageUrl,
        });
      }),
    );

    const now = new Date();
    const decorated = signedItems.map((item) => ({
      item,
      scores: calculateDiscoveryScores({
        item,
        now,
      }),
    }));

    const tagged = tagFilter === null
      ? decorated
      : decorated.filter(({ item }) => {
        const styleMatch = item.style_tags.some((tag) => normalizeTag(tag).includes(tagFilter));
        const moodMatch = item.mood_tags.some((tag) => normalizeTag(tag).includes(tagFilter));
        return styleMatch || moodMatch;
      });

    const filtered = tagged.filter(({ item, scores }) =>
      matchesDiscoveryFilter({
        filter,
        item,
        scores,
      }));

    const sorted = sortDecoratedItems(filtered, sort);
    const withDiscovery = sorted.map(({ item, scores }) => {
      const rankingScore =
        sort === "newest"
          ? clamp100(scores.recencyScore * 100)
          : sort === "most_remixed"
            ? clamp100(scores.remixSignal * 100)
            : sort === "best_quality"
              ? scores.qualityScore
              : sort === "most_cinematic"
                ? clamp100((scores.cinematicSignal * 0.6 + scores.qualityScore / 100 * 0.4) * 100)
                : sort === "most_surreal"
                  ? clamp100((scores.surrealSignal * 0.6 + scores.qualityScore / 100 * 0.4) * 100)
                  : sort === "most_refined" || sort === "most_varied"
                    ? clamp100(
                      (Math.min(item.refinement_count + item.variation_count, 16) / 16) * 60 +
                      (scores.qualityScore / 100) * 40,
                    )
                    : scores.trendingScore;
      const badges = getDiscoveryBadges({
        item,
        scores,
      });
      const featured = badges.includes("high_quality") || badges.includes("trending");

      return {
        ...item,
        quality_score: scores.qualityScore,
        ranking_score: rankingScore,
        sort_reason: decorateSortReason({
          sort,
          item,
          scores,
        }),
        featured,
        discovery_badges: featured ? [...badges, "featured"] : badges,
      };
    });

    const pageItems = withDiscovery.slice(0, limit);
    const nextCursor =
      sort === "newest" && filter === "all" && tagFilter === null
        ? raw.nextCursor
        : null;

    return {
      items: pageItems,
      next_cursor: nextCursor,
      request_id: input.requestId,
    };
  }

  public async getByShareSlug(input: {
    shareSlug: string;
    includeUnlisted: boolean;
    requestId: string;
  }): Promise<PublicGenerationDetailResponseDto> {
    const aggregate = await this.repository.getPublicGenerationByShareSlug({
      shareSlug: input.shareSlug,
      includeUnlisted: input.includeUnlisted,
    });
    if (aggregate === null) {
      throw new NotFoundAppError("Generation");
    }

    const selectedDirection = aggregate.visualPlan?.selectedCreativeDirectionId === null
      ? null
      : aggregate.creativeDirections.find(
        (direction) => direction.id === aggregate.visualPlan?.selectedCreativeDirectionId,
      ) ?? null;

    const variants = await Promise.all(
      aggregate.variants.map(async (variant) => {
        try {
          const signed = await this.assetSigner.sign({
            bucket: variant.storageBucket,
            path: variant.storagePath,
            expiresInSeconds: this.fullImageTtlSeconds,
          });

          return {
            image_variant_id: variant.id,
            signed_url: signed.url,
            expires_at: signed.expiresAt.toISOString(),
            branch_depth: variant.branchDepth,
            variation_type: variant.variationType,
            is_upscaled: variant.isUpscaled,
          };
        } catch (error) {
          this.logger.warn("public_generation_variant_sign_failed", {
            requestId: input.requestId,
            generationId: aggregate.generation.id,
            variantId: variant.id,
            path: variant.storagePath,
            error: error instanceof Error ? error.message : "UNKNOWN_SIGN_ERROR",
          });

          return {
            image_variant_id: variant.id,
            signed_url: null,
            expires_at: null,
            branch_depth: variant.branchDepth,
            variation_type: variant.variationType,
            is_upscaled: variant.isUpscaled,
          };
        }
      }),
    );

    const featured = aggregate.generation.featuredVariantId === null
      ? null
      : variants.find((variant) => variant.image_variant_id === aggregate.generation.featuredVariantId) ?? null;
    const featuredVariant = featured ?? variants[0] ?? null;

    const styleTags = selectedDirection?.directionJson.styleTags ?? [];
    const moodTags = [
      selectedDirection?.directionJson.colorPalette.mood ?? null,
      aggregate.visualPlan?.planJson.colorStrategy.mood ?? null,
    ].filter((entry): entry is string => entry !== null && entry.length > 0);

    const creatorPublicRows = await this.repository.listPublicGallery({
      limit: 60,
      cursor: null,
    });
    const creatorPublicItemsRaw = creatorPublicRows.items.filter((row) =>
      row.creatorProfileHandle === aggregate.creatorProfileHandle &&
      row.generationId !== aggregate.generation.id);

    const creatorPublicItemsSigned = await Promise.all(
      creatorPublicItemsRaw.map(async (row) => {
        let featuredImageUrl: string | null = null;
        if (row.featuredImagePath !== null) {
          try {
            const signed = await this.assetSigner.sign({
              bucket: this.imageStorageBucket,
              path: row.featuredImagePath,
              expiresInSeconds: this.thumbnailTtlSeconds,
            });
            featuredImageUrl = signed.url;
          } catch (error) {
            this.logger.warn("public_generation_creator_more_sign_failed", {
              requestId: input.requestId,
              generationId: row.generationId,
              path: row.featuredImagePath,
              error: error instanceof Error ? error.message : "UNKNOWN_SIGN_ERROR",
            });
          }
        }

        return mapGalleryRowToItem({
          row,
          featuredImageUrl,
        });
      }),
    );

    const creatorDecorated = creatorPublicItemsSigned
      .map((item) => ({
        item,
        scores: calculateDiscoveryScores({
          item,
          now: new Date(),
        }),
      }))
      .sort((a, b) => {
        if (b.scores.qualityScore !== a.scores.qualityScore) {
          return b.scores.qualityScore - a.scores.qualityScore;
        }
        return tieBreakGallery(a.item, b.item);
      })
      .slice(0, 6)
      .map(({ item, scores }) => ({
        generation_id: item.generation_id,
        share_slug: item.share_slug,
        summary: item.summary,
        published_at: item.published_at,
        featured_image_url: item.featured_image_url,
        remix_count: item.remix_count,
        quality_score: scores.qualityScore,
      }));

    this.logger.info("share_page_opened", {
      requestId: input.requestId,
      shareSlug: input.shareSlug,
      generationId: aggregate.generation.id,
      creatorUserId: aggregate.creatorUserId,
      creatorHandle: aggregate.creatorProfileHandle,
      relatedCount: creatorDecorated.length,
    });

    return {
      generation_id: aggregate.generation.id,
      share_slug: aggregate.generation.shareSlug,
      visibility: aggregate.generation.visibility === "unlisted" ? "unlisted" : "public",
      published_at: aggregate.generation.publishedAt?.toISOString() ?? null,
      creator_display_name: aggregate.creatorDisplayName,
      creator_profile_handle: aggregate.creatorProfileHandle,
      summary:
        aggregate.userIntent?.intentJson.summary ??
        aggregate.visualPlan?.explainabilityJson.summary ??
        aggregate.visualPlan?.planJson.summary ??
        "Pixora generation",
      selected_direction_title: selectedDirection?.directionTitle ?? null,
      visual_plan_summary: aggregate.visualPlan?.planJson.summary ?? null,
      explainability_summary: aggregate.visualPlan?.explainabilityJson.summary ?? null,
      emotion_to_visual_mapping: aggregate.visualPlan?.explainabilityJson.emotionToVisualMapping ?? null,
      style_tags: styleTags,
      mood_tags: moodTags,
      featured_variant: featuredVariant,
      variants,
      remix: {
        enabled: featuredVariant !== null,
        base_variant_id: featuredVariant?.image_variant_id ?? null,
        source_generation_id: aggregate.generation.id,
        source_variant_id: featuredVariant?.image_variant_id ?? null,
        remix_source_type: "public_generation",
      },
      lineage: {
        remix_depth: aggregate.lineage.remixDepth,
        root_public_generation_id: aggregate.lineage.rootPublicGenerationId,
        root_creator_id: aggregate.lineage.rootCreatorId,
        remix_source_generation_id: aggregate.lineage.remixSourceGenerationId,
        remix_source_variant_id: aggregate.lineage.remixSourceVariantId,
        derived_public_generation_count: aggregate.lineage.derivedPublicGenerationCount,
        derived_public_generation_ids: aggregate.lineage.derivedPublicGenerationIds,
      },
      social_proof: {
        remix_count: aggregate.socialProof.remixCount,
        branch_count: aggregate.socialProof.branchCount,
        total_public_variants: aggregate.socialProof.totalPublicVariants,
        creator_public_generation_count: aggregate.socialProof.creatorPublicGenerationCount,
      },
      creator_more_public: creatorDecorated,
      request_id: input.requestId,
    };
  }
}
