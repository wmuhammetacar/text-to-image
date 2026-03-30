import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthService } from "@vi/application";
import {
  ApplyRunRefundUseCase,
  ProcessGenerationRunUseCase,
  PublicGalleryUseCase,
  SubmitGenerationUseCase,
  UpdateGenerationVisibilityUseCase,
} from "@vi/application";
import {
  MockAssetSigner,
  MockEmotionAnalysisProvider,
  MockImageGenerationProvider,
  MockSafetyShapingProvider,
} from "@vi/providers";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import {
  NoopLogger,
  SequenceIdFactory,
  SequenceRequestIdFactory,
} from "../helpers/test-doubles";

const OWNER_USER_ID = "00000000-0000-0000-0000-000000009101";
const OTHER_USER_ID = "00000000-0000-0000-0000-000000009102";

interface PublicApiContext {
  repository: InMemoryRepository;
  deps: {
    submitGenerationUseCase: SubmitGenerationUseCase;
    updateGenerationVisibilityUseCase: UpdateGenerationVisibilityUseCase;
    publicGalleryUseCase: PublicGalleryUseCase;
    authService: AuthService;
    requestIdFactory: SequenceRequestIdFactory;
    logger: NoopLogger;
  };
}

function createContext(params: {
  authUserId?: string;
} = {}): PublicApiContext {
  const repository = new InMemoryRepository();
  repository.seedUser(OWNER_USER_ID, 50);
  repository.seedUser(OTHER_USER_ID, 50);

  const logger = new NoopLogger();
  const requestIdFactory = new SequenceRequestIdFactory([
    "req_public_0001",
    "req_public_0002",
    "req_public_0003",
    "req_public_0004",
    "req_public_0005",
    "req_public_0006",
    "req_public_0007",
    "req_public_0008",
  ]);

  const authUserId = params.authUserId ?? OWNER_USER_ID;

  return {
    repository,
    deps: {
      submitGenerationUseCase: new SubmitGenerationUseCase(
        repository,
        new MockSafetyShapingProvider(),
        new SequenceIdFactory([
          "79000000-0000-4000-8000-000000000001",
          "79000000-0000-4000-8000-000000000002",
          "79000000-0000-4000-8000-000000000003",
          "79000000-0000-4000-8000-000000000004",
        ]),
        logger,
      ),
      updateGenerationVisibilityUseCase: new UpdateGenerationVisibilityUseCase(
        repository,
        logger,
      ),
      publicGalleryUseCase: new PublicGalleryUseCase(
        repository,
        new MockAssetSigner(),
        logger,
        600,
        1800,
        "generated-images",
      ),
      authService: {
        requireUserFromRequest: async () => ({
          id: authUserId,
          email: `${authUserId}@example.com`,
        }),
      },
      requestIdFactory,
      logger,
    },
  };
}

async function seedCompletedGeneration(context: PublicApiContext): Promise<{
  generationId: string;
  shareSlug: string;
  featuredVariantId: string;
}> {
  return seedCompletedGenerationWithInput(context, {
    idempotencyKey: "idem-public-seed-1",
    text: "Sisli neon bir şehir sahnesi",
    controls: {
      cinematic: 2,
    },
  });
}

async function seedCompletedGenerationWithInput(
  context: PublicApiContext,
  params: {
    idempotencyKey: string;
    text: string;
    controls: Record<string, number>;
  },
): Promise<{
  generationId: string;
  shareSlug: string;
  featuredVariantId: string;
}> {
  const submitted = await context.deps.submitGenerationUseCase.execute({
    userId: OWNER_USER_ID,
    idempotencyKey: params.idempotencyKey,
    payload: {
      text: params.text,
      requested_image_count: 2,
      creative_mode: "balanced",
      controls: params.controls,
    },
    requestId: "req_public_seed_submit_1",
    creditCostPerImage: 1,
  });

  const process = new ProcessGenerationRunUseCase(
    context.repository,
    new MockEmotionAnalysisProvider(),
    new MockSafetyShapingProvider(),
    new MockImageGenerationProvider(),
    new ApplyRunRefundUseCase(context.repository, context.deps.logger, 1),
    context.deps.logger,
  );

  await process.execute({
    runId: submitted.run_id,
    requestId: "req_public_seed_process_1",
  });

  const aggregate = await context.repository.getGenerationDetailForService(submitted.generation_id);
  if (aggregate === null) {
    throw new Error("AGGREGATE_NOT_FOUND");
  }

  const completed = aggregate.variants.find((variant) => variant.status === "completed");
  if (completed === undefined) {
    throw new Error("COMPLETED_VARIANT_NOT_FOUND");
  }

  return {
    generationId: submitted.generation_id,
    shareSlug: aggregate.generation.shareSlug,
    featuredVariantId: completed.id,
  };
}

async function loadVisibilityRoute(deps: PublicApiContext["deps"]) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/generations/[id]/visibility/route");
}

async function loadPublicGalleryRoute(deps: PublicApiContext["deps"]) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/public/gallery/route");
}

async function loadPublicGenerationRoute(deps: PublicApiContext["deps"]) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/public/generations/[slug]/route");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API public gallery + visibility", () => {
  it("private generation gallery ve public detail endpointlerinde görünmez", async () => {
    const context = createContext();
    const seeded = await seedCompletedGeneration(context);
    const galleryRoute = await loadPublicGalleryRoute(context.deps);
    const publicDetailRoute = await loadPublicGenerationRoute(context.deps);

    const galleryResponse = await galleryRoute.GET(
      new Request("http://localhost/api/v1/public/gallery"),
    );
    const galleryBody = (await galleryResponse.json()) as { items: Array<{ generation_id: string }> };

    expect(galleryResponse.status).toBe(200);
    expect(galleryBody.items.some((item) => item.generation_id === seeded.generationId)).toBe(false);

    const detailResponse = await publicDetailRoute.GET(
      new Request(`http://localhost/api/v1/public/generations/${seeded.shareSlug}`),
      {
        params: Promise.resolve({ slug: seeded.shareSlug }),
      },
    );
    const detailBody = (await detailResponse.json()) as { error: { code: string } };

    expect(detailResponse.status).toBe(404);
    expect(detailBody.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("visibility public yapıldığında gallery listesinde görünür ve public detail döner", async () => {
    const context = createContext();
    const seeded = await seedCompletedGeneration(context);
    const visibilityRoute = await loadVisibilityRoute(context.deps);
    const galleryRoute = await loadPublicGalleryRoute(context.deps);
    const publicDetailRoute = await loadPublicGenerationRoute(context.deps);

    const patchResponse = await visibilityRoute.PATCH(
      new Request(`http://localhost/api/v1/generations/${seeded.generationId}/visibility`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer owner-token",
        },
        body: JSON.stringify({
          visibility: "public",
          featured_variant_id: seeded.featuredVariantId,
        }),
      }),
      {
        params: Promise.resolve({ id: seeded.generationId }),
      },
    );

    expect(patchResponse.status).toBe(200);

    const galleryResponse = await galleryRoute.GET(
      new Request("http://localhost/api/v1/public/gallery?limit=20"),
    );
    const galleryBody = (await galleryResponse.json()) as {
      items: Array<{
        generation_id: string;
        visibility: string;
        creator_profile_handle: string;
        remix_count: number;
        branch_count: number;
        total_public_variants: number;
        creator_public_generation_count: number;
      }>;
    };

    expect(galleryResponse.status).toBe(200);
    expect(galleryBody.items.some((item) => item.generation_id === seeded.generationId)).toBe(true);
    const listed = galleryBody.items.find((item) => item.generation_id === seeded.generationId);
    expect(listed?.visibility).toBe("public");
    expect(listed?.creator_profile_handle).toContain("creator_");
    expect(typeof listed?.remix_count).toBe("number");
    expect(typeof listed?.branch_count).toBe("number");
    expect(typeof listed?.total_public_variants).toBe("number");
    expect(typeof listed?.creator_public_generation_count).toBe("number");

    const detailResponse = await publicDetailRoute.GET(
      new Request(`http://localhost/api/v1/public/generations/${seeded.shareSlug}`),
      {
        params: Promise.resolve({ slug: seeded.shareSlug }),
      },
    );
    const detailBody = (await detailResponse.json()) as {
      generation_id: string;
      visibility: string;
      creator_profile_handle: string;
      creator_more_public: Array<{
        generation_id: string;
        share_slug: string;
        summary: string;
        quality_score: number;
      }>;
      social_proof: {
        remix_count: number;
        branch_count: number;
        total_public_variants: number;
        creator_public_generation_count: number;
      };
      lineage: {
        remix_depth: number;
        root_public_generation_id: string | null;
        derived_public_generation_count: number;
      };
      remix: { enabled: boolean; source_generation_id: string };
      creator_email?: string;
    };

    expect(detailResponse.status).toBe(200);
    expect(detailBody.generation_id).toBe(seeded.generationId);
    expect(detailBody.visibility).toBe("public");
    expect(detailBody.creator_profile_handle).toContain("creator_");
    expect(detailBody.social_proof.total_public_variants).toBeGreaterThan(0);
    expect(detailBody.lineage.remix_depth).toBe(0);
    expect(detailBody.remix.enabled).toBe(true);
    expect(detailBody.remix.source_generation_id).toBe(seeded.generationId);
    expect(Array.isArray(detailBody.creator_more_public)).toBe(true);
    expect(detailBody.creator_more_public.every((item) => item.quality_score >= 0)).toBe(true);
    expect(detailBody.creator_email).toBeUndefined();
  });

  it("visibility unlisted iken gallery dışı kalır, direct share ile görünür", async () => {
    const context = createContext();
    const seeded = await seedCompletedGeneration(context);
    const visibilityRoute = await loadVisibilityRoute(context.deps);
    const galleryRoute = await loadPublicGalleryRoute(context.deps);
    const publicDetailRoute = await loadPublicGenerationRoute(context.deps);

    await visibilityRoute.PATCH(
      new Request(`http://localhost/api/v1/generations/${seeded.generationId}/visibility`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer owner-token",
        },
        body: JSON.stringify({
          visibility: "unlisted",
          featured_variant_id: seeded.featuredVariantId,
        }),
      }),
      {
        params: Promise.resolve({ id: seeded.generationId }),
      },
    );

    const galleryResponse = await galleryRoute.GET(
      new Request("http://localhost/api/v1/public/gallery"),
    );
    const galleryBody = (await galleryResponse.json()) as { items: Array<{ generation_id: string }> };

    expect(galleryBody.items.some((item) => item.generation_id === seeded.generationId)).toBe(false);

    const detailResponse = await publicDetailRoute.GET(
      new Request(`http://localhost/api/v1/public/generations/${seeded.shareSlug}`),
      {
        params: Promise.resolve({ slug: seeded.shareSlug }),
      },
    );
    const detailBody = (await detailResponse.json()) as { visibility: string };

    expect(detailResponse.status).toBe(200);
    expect(detailBody.visibility).toBe("unlisted");
  });

  it("visibility update ownership ister; başka kullanıcı 404 alır", async () => {
    const context = createContext({
      authUserId: OTHER_USER_ID,
    });
    const seeded = await seedCompletedGeneration(context);

    const visibilityRoute = await loadVisibilityRoute(context.deps);
    const response = await visibilityRoute.PATCH(
      new Request(`http://localhost/api/v1/generations/${seeded.generationId}/visibility`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer other-token",
        },
        body: JSON.stringify({
          visibility: "public",
          featured_variant_id: seeded.featuredVariantId,
        }),
      }),
      {
        params: Promise.resolve({ id: seeded.generationId }),
      },
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("gallery sort/ranking deterministic çalışır ve featured alanlarını döner", async () => {
    const context = createContext();
    const first = await seedCompletedGenerationWithInput(context, {
      idempotencyKey: "idem-public-seed-deterministic-1",
      text: "Cinematic yağmurlu gece sahnesi",
      controls: {
        cinematic: 2,
      },
    });
    const second = await seedCompletedGenerationWithInput(context, {
      idempotencyKey: "idem-public-seed-deterministic-2",
      text: "Surreal renk patlaması olan yaratıcı bir portre",
      controls: {
        darkness: 0,
        calmness: 0,
        nostalgia: 0,
        cinematic: 1,
      },
    });

    const visibilityRoute = await loadVisibilityRoute(context.deps);
    const galleryRoute = await loadPublicGalleryRoute(context.deps);

    for (const seeded of [first, second]) {
      await visibilityRoute.PATCH(
        new Request(`http://localhost/api/v1/generations/${seeded.generationId}/visibility`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer owner-token",
          },
          body: JSON.stringify({
            visibility: "public",
            featured_variant_id: seeded.featuredVariantId,
          }),
        }),
        {
          params: Promise.resolve({ id: seeded.generationId }),
        },
      );
    }

    const trendingResponseA = await galleryRoute.GET(
      new Request("http://localhost/api/v1/public/gallery?sort=trending&limit=20"),
    );
    const trendingBodyA = (await trendingResponseA.json()) as {
      items: Array<{
        generation_id: string;
        featured: boolean;
        quality_score: number;
        ranking_score: number;
        sort_reason: string;
        discovery_badges: string[];
      }>;
    };

    const trendingResponseB = await galleryRoute.GET(
      new Request("http://localhost/api/v1/public/gallery?sort=trending&limit=20"),
    );
    const trendingBodyB = (await trendingResponseB.json()) as {
      items: Array<{ generation_id: string }>;
    };

    expect(trendingResponseA.status).toBe(200);
    expect(trendingBodyA.items.length).toBeGreaterThanOrEqual(2);
    expect(trendingBodyA.items.map((item) => item.generation_id)).toEqual(
      trendingBodyB.items.map((item) => item.generation_id),
    );
    expect(typeof trendingBodyA.items[0]?.quality_score).toBe("number");
    expect(typeof trendingBodyA.items[0]?.ranking_score).toBe("number");
    expect(trendingBodyA.items[0]?.sort_reason.length).toBeGreaterThan(0);
    expect(Array.isArray(trendingBodyA.items[0]?.discovery_badges)).toBe(true);
    expect(typeof trendingBodyA.items[0]?.featured).toBe("boolean");
  });

  it("gallery discovery filter high_quality doğru çalışır", async () => {
    const context = createContext();
    const seeded = await seedCompletedGeneration(context);
    const visibilityRoute = await loadVisibilityRoute(context.deps);
    const galleryRoute = await loadPublicGalleryRoute(context.deps);

    await visibilityRoute.PATCH(
      new Request(`http://localhost/api/v1/generations/${seeded.generationId}/visibility`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer owner-token",
        },
        body: JSON.stringify({
          visibility: "public",
          featured_variant_id: seeded.featuredVariantId,
        }),
      }),
      {
        params: Promise.resolve({ id: seeded.generationId }),
      },
    );

    const filteredResponse = await galleryRoute.GET(
      new Request("http://localhost/api/v1/public/gallery?filter=high_quality&limit=20"),
    );
    const filteredBody = (await filteredResponse.json()) as {
      items: Array<{ generation_id: string; quality_score: number }>;
    };

    expect(filteredResponse.status).toBe(200);
    expect(filteredBody.items.every((item) => item.quality_score >= 70)).toBe(true);
  });

  it("share detail creator_more_public listesi boş dönmez (uygun veri varsa)", async () => {
    const context = createContext();
    const first = await seedCompletedGenerationWithInput(context, {
      idempotencyKey: "idem-public-seed-creator-more-1",
      text: "Cinematic creator sahnesi",
      controls: { cinematic: 2 },
    });
    const second = await seedCompletedGenerationWithInput(context, {
      idempotencyKey: "idem-public-seed-creator-more-2",
      text: "Creator ikinci public üretimi",
      controls: { cinematic: 1 },
    });

    const visibilityRoute = await loadVisibilityRoute(context.deps);
    const publicDetailRoute = await loadPublicGenerationRoute(context.deps);

    for (const seeded of [first, second]) {
      await visibilityRoute.PATCH(
        new Request(`http://localhost/api/v1/generations/${seeded.generationId}/visibility`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer owner-token",
          },
          body: JSON.stringify({
            visibility: "public",
            featured_variant_id: seeded.featuredVariantId,
          }),
        }),
        {
          params: Promise.resolve({ id: seeded.generationId }),
        },
      );
    }

    const detailResponse = await publicDetailRoute.GET(
      new Request(`http://localhost/api/v1/public/generations/${first.shareSlug}`),
      {
        params: Promise.resolve({ slug: first.shareSlug }),
      },
    );
    const detailBody = (await detailResponse.json()) as {
      creator_more_public: Array<{ generation_id: string }>;
    };

    expect(detailResponse.status).toBe(200);
    expect(detailBody.creator_more_public.length).toBeGreaterThan(0);
    expect(detailBody.creator_more_public.some((entry) => entry.generation_id === second.generationId)).toBe(true);
  });
});
