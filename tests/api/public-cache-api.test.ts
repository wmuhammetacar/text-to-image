import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NoopLogger,
  SequenceRequestIdFactory,
} from "../helpers/test-doubles";
import { resetResponseCacheForTests } from "../../apps/web/lib/response-cache";

function createPublicDeps() {
  const requestIdFactory = new SequenceRequestIdFactory([
    "req_public_cache_0001",
    "req_public_cache_0002",
    "req_public_cache_0003",
  ]);
  return {
    requestIdFactory,
    logger: new NoopLogger(),
    config: {
      PUBLIC_GALLERY_CACHE_TTL_SECONDS: 30,
      PUBLIC_GENERATION_CACHE_TTL_SECONDS: 30,
    },
  };
}

async function loadPublicGalleryRoute(params: {
  deps: ReturnType<typeof createPublicDeps> & {
    publicGalleryUseCase: {
      list: (input: unknown) => Promise<{
        items: unknown[];
        next_cursor: string | null;
        request_id: string;
      }>;
    };
  };
}) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => params.deps,
  }));
  return import("../../apps/web/app/api/v1/public/gallery/route");
}

async function loadPublicDetailRoute(params: {
  deps: ReturnType<typeof createPublicDeps> & {
    publicGalleryUseCase: {
      getByShareSlug: (input: unknown) => Promise<{
        generation_id: string;
        share_slug: string;
        visibility: "public" | "unlisted";
        published_at: string | null;
        creator_display_name: string;
        creator_profile_handle: string;
        summary: string;
        selected_direction_title: string | null;
        visual_plan_summary: string | null;
        explainability_summary: string | null;
        emotion_to_visual_mapping: string | null;
        style_tags: string[];
        mood_tags: string[];
        featured_variant: {
          image_variant_id: string;
          signed_url: string | null;
          expires_at: string | null;
          branch_depth: number;
          variation_type: null;
          is_upscaled: boolean;
        } | null;
        variants: Array<{
          image_variant_id: string;
          signed_url: string | null;
          expires_at: string | null;
          branch_depth: number;
          variation_type: null;
          is_upscaled: boolean;
        }>;
        remix: {
          enabled: boolean;
          base_variant_id: string | null;
          source_generation_id: string;
          source_variant_id: string | null;
          remix_source_type: "public_generation";
        };
        lineage: {
          remix_depth: number;
          root_public_generation_id: string | null;
          root_creator_id: string | null;
          remix_source_generation_id: string | null;
          remix_source_variant_id: string | null;
          derived_public_generation_count: number;
          derived_public_generation_ids: string[];
        };
        social_proof: {
          remix_count: number;
          branch_count: number;
          total_public_variants: number;
          creator_public_generation_count: number;
        };
        creator_more_public: Array<{
          generation_id: string;
          share_slug: string;
          summary: string;
          published_at: string;
          featured_image_url: string | null;
          remix_count: number;
          quality_score: number;
        }>;
        request_id: string;
      }>;
    };
  };
}) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => params.deps,
  }));
  return import("../../apps/web/app/api/v1/public/generations/[slug]/route");
}

afterEach(() => {
  vi.restoreAllMocks();
  resetResponseCacheForTests();
});

describe("Public cache katmanı", () => {
  it("gallery aynı query için cache hit ile use-case çağrısını düşürür", async () => {
    let callCount = 0;
    const deps = createPublicDeps();
    const route = await loadPublicGalleryRoute({
      deps: {
        ...deps,
        publicGalleryUseCase: {
          list: async () => {
            callCount += 1;
            return {
              items: [],
              next_cursor: null,
              request_id: `req_upstream_${callCount}`,
            };
          },
        },
      },
    });

    const request = new Request("http://localhost/api/v1/public/gallery?sort=trending&limit=12");
    const first = await route.GET(request);
    const second = await route.GET(request);
    const firstBody = (await first.json()) as { request_id: string };
    const secondBody = (await second.json()) as { request_id: string };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(callCount).toBe(1);
    expect(firstBody.request_id).not.toBe(secondBody.request_id);
  });

  it("public detail aynı slug için cache hit ile tekrar hesaplamayı engeller", async () => {
    let callCount = 0;
    const deps = createPublicDeps();
    const route = await loadPublicDetailRoute({
      deps: {
        ...deps,
        publicGalleryUseCase: {
          getByShareSlug: async () => {
            callCount += 1;
            return {
              generation_id: "a1000000-0000-4000-8000-000000000001",
              share_slug: "sharecache001",
              visibility: "public",
              published_at: "2026-03-30T12:00:00.000Z",
              creator_display_name: "Cache Creator",
              creator_profile_handle: "cache_creator",
              summary: "Cache test summary",
              selected_direction_title: "Direction",
              visual_plan_summary: "Visual plan summary",
              explainability_summary: "Explainability summary",
              emotion_to_visual_mapping: "mapping",
              style_tags: ["cinematic"],
              mood_tags: ["dramatic"],
              featured_variant: {
                image_variant_id: "b1000000-0000-4000-8000-000000000001",
                signed_url: null,
                expires_at: null,
                branch_depth: 0,
                variation_type: null,
                is_upscaled: false,
              },
              variants: [
                {
                  image_variant_id: "b1000000-0000-4000-8000-000000000001",
                  signed_url: null,
                  expires_at: null,
                  branch_depth: 0,
                  variation_type: null,
                  is_upscaled: false,
                },
              ],
              remix: {
                enabled: true,
                base_variant_id: "b1000000-0000-4000-8000-000000000001",
                source_generation_id: "a1000000-0000-4000-8000-000000000001",
                source_variant_id: "b1000000-0000-4000-8000-000000000001",
                remix_source_type: "public_generation",
              },
              lineage: {
                remix_depth: 0,
                root_public_generation_id: null,
                root_creator_id: null,
                remix_source_generation_id: null,
                remix_source_variant_id: null,
                derived_public_generation_count: 0,
                derived_public_generation_ids: [],
              },
              social_proof: {
                remix_count: 0,
                branch_count: 0,
                total_public_variants: 1,
                creator_public_generation_count: 1,
              },
              creator_more_public: [],
              request_id: `req_upstream_detail_${callCount}`,
            };
          },
        },
      },
    });

    const first = await route.GET(
      new Request("http://localhost/api/v1/public/generations/sharecache001"),
      { params: Promise.resolve({ slug: "sharecache001" }) },
    );
    const second = await route.GET(
      new Request("http://localhost/api/v1/public/generations/sharecache001"),
      { params: Promise.resolve({ slug: "sharecache001" }) },
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(callCount).toBe(1);
  });
});

