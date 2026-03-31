import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VariationRequestDto } from "@vi/contracts";
import { ExplainabilityPanel } from "../../apps/web/components/generator/explainability-panel";
import { ReturningSessionCard } from "../../apps/web/components/generator/returning-session-card";
import { StarterPrompts } from "../../apps/web/components/generator/starter-prompts";
import { ResultCard } from "../../apps/web/components/gallery/result-card";
import { buildShareLoginRedirectPath } from "../../apps/web/components/gallery/public-generation-share-view";
import { selectSuggestedQuickActionKeys } from "../../apps/web/components/generator/generation-detail-view";
import { createProductEventTracker } from "../../apps/web/lib/product-events";
import {
  executeQuickAction,
  executeUpscaleAction,
  quickActionDefinitions,
} from "../../apps/web/components/generator/quick-actions";
import {
  createGeneratorUiState,
  getLoadingExperienceMessage,
  setLastAction,
  setLoadingVariant,
  setSelectedVariant,
} from "../../apps/web/lib/ui-state";

describe("UX + Magic Layer", () => {
  it("quick action doğru variation payload ile API çağrısı yapar", async () => {
    const dramaticAction = quickActionDefinitions.find((action) => action.key === "more_dramatic");
    if (dramaticAction === undefined) {
      throw new Error("QUICK_ACTION_NOT_FOUND");
    }

    let capturedPayload: VariationRequestDto | null = null;

    const result = await executeQuickAction({
      baseVariantId: "00000000-0000-0000-0000-000000000901",
      action: dramaticAction,
      submitVariation: async (payload) => {
        capturedPayload = payload;
        return {
          generationId: "00000000-0000-0000-0000-000000000902",
          runId: "00000000-0000-0000-0000-000000000903",
          variationType: payload.variation_type,
          requestId: "req_ui_quick_action_1",
        };
      },
    });

    expect(capturedPayload?.base_variant_id).toBe("00000000-0000-0000-0000-000000000901");
    expect(capturedPayload?.variation_type).toBe("more_dramatic");
    expect(capturedPayload?.requested_image_count).toBe(1);
    expect(result.runId).toBe("00000000-0000-0000-0000-000000000903");
    expect(result.variationType).toBe("more_dramatic");
  });

  it("upscale aksiyonu variant_id ile çağrılır ve run döner", async () => {
    let capturedVariantId: string | null = null;

    const result = await executeUpscaleAction({
      variantId: "00000000-0000-0000-0000-000000000911",
      submitUpscale: async (payload) => {
        capturedVariantId = payload.variant_id;
        return {
          generationId: "00000000-0000-0000-0000-000000000912",
          runId: "00000000-0000-0000-0000-000000000913",
          requestId: "req_ui_upscale_1",
        };
      },
    });

    expect(capturedVariantId).toBe("00000000-0000-0000-0000-000000000911");
    expect(result.runId).toBe("00000000-0000-0000-0000-000000000913");
  });

  it("variant selection state helper seçimi, loading ve lastAction bilgisini taşır", () => {
    const initial = createGeneratorUiState(null);
    const selected = setSelectedVariant(initial, "variant-1");
    const loading = setLoadingVariant(selected, "variant-1");
    const finalState = setLastAction(loading, {
      type: "variation",
      label: "Daha dramatik yap",
      runId: "run-1",
    });

    expect(initial.selectedVariantId).toBeNull();
    expect(selected.selectedVariantId).toBe("variant-1");
    expect(loading.loadingVariantId).toBe("variant-1");
    expect(finalState.lastAction?.type).toBe("variation");
    expect(finalState.lastAction?.label).toBe("Daha dramatik yap");
    expect(finalState.lastAction?.runId).toBe("run-1");
  });

  it("explainability panel kullanıcı dostu kısa metinleri render eder", () => {
    const markup = renderToStaticMarkup(
      <ExplainabilityPanel
        userIntentSummary="Sistem şehirde yalnızlık ve gerilim hissini ana niyet olarak algıladı."
        selectedDirectionReason="Dramatik gece kompozisyonu, niyet-eşleşme ve kontrol gücü skoru en yüksek olduğu için seçildi."
        emotionToVisualMapping="Melankoli düşük doygunluk ve yanal yumuşak ışık ile; gerilim yüksek kontrast gölgeler ile işlendi."
        conciseReasoning="Önce atmosfer ve odak hiyerarşisi sabitlendi, ardından ışık-kontrast dengesi yaratıcı hedefe göre yükseltildi."
      />,
    );

    expect(markup).toContain("AI ne anladı");
    expect(markup).toContain("Seçilen yön neden seçildi");
    expect(markup).toContain("Duygu → görsel eşleşmesi");
    expect(markup).toContain("Kısa reasoning");
    expect(markup).toContain("Sistem şehirde yalnızlık");
  });

  it("loading experience mesajı pass ilerleyişine göre değişir", () => {
    const analyzing = getLoadingExperienceMessage({
      active_run_state: "analyzing",
      passes: [],
    });

    const generatingDetail = getLoadingExperienceMessage({
      active_run_state: "generating",
      passes: [
        {
          pass_id: "00000000-0000-0000-0000-000000001001",
          run_id: "00000000-0000-0000-0000-000000001002",
          pass_type: "concept",
          pass_index: 1,
          status: "completed",
          summary: "ok",
          input_artifact_count: 0,
          output_artifact_count: 1,
          started_at: null,
          completed_at: null,
        },
        {
          pass_id: "00000000-0000-0000-0000-000000001003",
          run_id: "00000000-0000-0000-0000-000000001002",
          pass_type: "composition",
          pass_index: 2,
          status: "running",
          summary: "running",
          input_artifact_count: 1,
          output_artifact_count: 0,
          started_at: null,
          completed_at: null,
        },
      ],
    });

    const completed = getLoadingExperienceMessage({
      active_run_state: "completed",
      passes: [],
    });

    expect(analyzing).toContain("AI düşünüyor");
    expect(generatingDetail).toContain("Kadraj ve perspektif ayarlanıyor");
    expect(completed).toBeNull();
  });

  it("gallery card creator attribution ve social proof sinyallerini render eder", () => {
    const markup = renderToStaticMarkup(
      <ResultCard
        item={{
          generation_id: "00000000-0000-0000-0000-000000009991",
          share_slug: "abc123slug",
          visibility: "public",
          published_at: "2026-03-30T18:00:00.000Z",
          creator_display_name: "Pixora Creator",
          creator_profile_handle: "creator_pixora",
          summary: "Neon yağmur altında sinematik bir portre",
          style_tags: ["cinematic", "expressive"],
          mood_tags: ["melancholic"],
          featured_image_url: "https://example.com/image.png",
          total_runs: 3,
          variation_count: 4,
          refinement_count: 2,
          remix_count: 5,
          branch_count: 8,
          total_public_variants: 6,
          creator_public_generation_count: 12,
          quality_score: 84.6,
          ranking_score: 78.2,
          sort_reason: "Trending skoru yüksek: trend 78.2 / kalite 84.6.",
          featured: true,
          discovery_badges: ["high_quality", "trending", "featured"],
        }}
      />,
    );

    expect(markup).toContain("@creator_pixora");
    expect(markup).toContain("Remix: 5");
    expect(markup).toContain("Branch: 8");
    expect(markup).toContain("Variation: 4");
    expect(markup).toContain("Featured");
    expect(markup).toContain("Quality:");
  });

  it("activation starter bileşeni önerileri render eder", () => {
    const markup = renderToStaticMarkup(
      <StarterPrompts
        presets={[
          {
            id: "starter_1",
            label: "Cinematic Şehir",
            text: "Neon yağmur altında sinematik bir sahne",
            creativeMode: "directed",
          },
        ]}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain("İlk üretimi başlat");
    expect(markup).toContain("Cinematic Şehir");
    expect(markup).toContain("mod: directed");
  });

  it("retention returning session kartı render olur", () => {
    const markup = renderToStaticMarkup(
      <ReturningSessionCard
        generationId="00000000-0000-0000-0000-000000009991"
        activeRunState="generating"
        unfinished={true}
        onContinue={() => undefined}
      />,
    );

    expect(markup).toContain("Kaldığın yerden devam et");
    expect(markup).toContain("Devam eden üretimi aç");
    expect(markup).toContain("durum: generating");
  });

  it("share CTA login redirect path auto remix context taşır", () => {
    const path = buildShareLoginRedirectPath({
      shareSlug: "abc123slug",
      remixType: "more_dramatic",
    });

    expect(path).toContain("/login?next=");
    expect(path).toContain(encodeURIComponent("/share/abc123slug?auto_remix=1&remix_type=more_dramatic&from=share_remix"));
  });

  it("suggested action seçimi cinematic inputta boş dönmez", () => {
    const keys = selectSuggestedQuickActionKeys(["cinematic", "dramatic"]);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(keys).toContain("more_dramatic");
  });

  it("product analytics tracker once davranışı aynı eventi tekrar göndermez", () => {
    const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const memoryStore = new Map<string, string>();
    const tracker = createProductEventTracker({
      sink: {
        capture: (eventName, payload) => {
          calls.push({
            name: eventName,
            payload,
          });
        },
      },
      store: {
        getItem: (key) => memoryStore.get(key) ?? null,
        setItem: (key, value) => {
          memoryStore.set(key, value);
        },
      },
    });

    tracker.trackOnce("first_generation_created", {
      source: "test",
    });
    tracker.trackOnce("first_generation_created", {
      source: "test",
    });
    tracker.track("gallery_opened", {
      source: "test",
    });
    tracker.track("share_clicked", {
      source: "test",
      cta: "create_your_own",
    });
    tracker.track("creator_viewed", {
      creator_handle: "creator_test",
    });

    expect(calls).toHaveLength(4);
    expect(calls[0]?.name).toBe("first_generation_created");
    expect(calls[1]?.name).toBe("gallery_opened");
    expect(calls[2]?.name).toBe("share_clicked");
    expect(calls[3]?.name).toBe("creator_viewed");
  });
});
