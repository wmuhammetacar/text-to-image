"use client";

import { useEffect, useState } from "react";
import {
  generationRequestBodySchema,
  type GenerationRequestDto,
} from "@vi/contracts";
import { SlidersHorizontal, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { ApiClientError, createGeneration, listGenerationHistory } from "../../lib/api-client";
import {
  isFeatureEnabled,
  resolveExperimentVariant,
  trackExperimentExposure,
} from "../../lib/experimentation";
import { isTerminalRunState } from "../../lib/polling";
import { trackProductEvent, trackProductEventOnce } from "../../lib/product-events";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { ReturningSessionCard } from "./returning-session-card";
import { StarterPrompts, type StarterPromptPreset } from "./starter-prompts";
import { Textarea } from "../ui/textarea";

interface ControlsState {
  darkness: number;
  calmness: number;
  nostalgia: number;
  cinematic: number;
}

interface StarterPreset extends StarterPromptPreset {
  id: string;
  label: string;
  text: string;
  creativeMode: GenerationRequestDto["creative_mode"];
  controls: ControlsState;
}

export const starterPresets: StarterPreset[] = [
  {
    id: "cinematic_rain_alley",
    label: "Sinematik Yağmur",
    category: "Sinematik sahne",
    text: "Yağmurlu bir gecede neon tabelalar altında yürüyen yalnız karakter, güçlü sinematik ışık ve gerilimli atmosfer.",
    creativeMode: "directed",
    controls: {
      darkness: 1,
      calmness: 0,
      nostalgia: 0,
      cinematic: 2,
    },
  },
  {
    id: "portrait_soft_light",
    label: "Yumuşak Portre",
    category: "Portre",
    text: "Doğal ışıkta çekilmiş, sakin ama etkileyici bir portre; gözlerde netlik, arka planda yumuşak bokeh.",
    creativeMode: "balanced",
    controls: {
      darkness: -1,
      calmness: 1,
      nostalgia: 0,
      cinematic: 0,
    },
  },
  {
    id: "fantasy_floating_temple",
    label: "Uçan Tapınak",
    category: "Fantastik",
    text: "Bulutların üzerinde süzülen antik bir tapınak, altın gün batımı ışığı ve epik atmosfer.",
    creativeMode: "directed",
    controls: {
      darkness: 0,
      calmness: 1,
      nostalgia: 0,
      cinematic: 2,
    },
  },
  {
    id: "product_luxury_watch",
    label: "Lüks Ürün Çekimi",
    category: "Ürün",
    text: "Siyah taş zemin üzerinde premium kol saati, keskin stüdyo ışığı, yüksek detay ve temiz yansıma.",
    creativeMode: "balanced",
    controls: {
      darkness: 1,
      calmness: 0,
      nostalgia: -1,
      cinematic: 1,
    },
  },
  {
    id: "city_dawn_bridge",
    label: "Şehir Şafağı",
    category: "Şehir",
    text: "Şafakta boş köprü üzerinde hafif sisli modern şehir manzarası, pastel tonlar ve sakin ritim.",
    creativeMode: "balanced",
    controls: {
      darkness: -1,
      calmness: 2,
      nostalgia: 1,
      cinematic: 1,
    },
  },
  {
    id: "art_abstract_expression",
    label: "Soyut Sanat",
    category: "Sanat",
    text: "Dinamik fırça darbeleri, katmanlı dokular ve duygusal renk patlamasıyla modern soyut kompozisyon.",
    creativeMode: "directed",
    controls: {
      darkness: 0,
      calmness: -1,
      nostalgia: 0,
      cinematic: 1,
    },
  },
  {
    id: "cinematic_desert_convoy",
    label: "Çöl Takibi",
    category: "Sinematik sahne",
    text: "Toz bulutu içinde hızla ilerleyen araç konvoyu, sert güneş ışığı, geniş açı ve yoğun hareket hissi.",
    creativeMode: "directed",
    controls: {
      darkness: 1,
      calmness: -1,
      nostalgia: 0,
      cinematic: 2,
    },
  },
  {
    id: "portrait_dreamy_memory",
    label: "Nostaljik Portre",
    category: "Portre",
    text: "Altın saat ışığında çekilmiş nostaljik portre, sıcak renkler, film dokusu ve dingin bir ifade.",
    creativeMode: "balanced",
    controls: {
      darkness: -1,
      calmness: 1,
      nostalgia: 2,
      cinematic: 1,
    },
  },
];

function toControlValue(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  if (parsed > 2) {
    return 2;
  }
  if (parsed < -2) {
    return -2;
  }
  return parsed;
}

function mapErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "RATE_LIMITED") {
      const retryAfter = error.details?.retry_after_seconds;
      if (typeof retryAfter === "number" && retryAfter > 0) {
        return `Çok sık istek gönderildi. ${Math.ceil(retryAfter)} saniye sonra tekrar deneyin.`;
      }
      return "Çok sık istek gönderildi. Lütfen kısa süre sonra tekrar deneyin.";
    }

    if (error.code === "INSUFFICIENT_CREDITS") {
      const paywallReason = error.details?.paywall_reason;
      if (paywallReason === "free_daily_limit") {
        return "Günlük ücretsiz limit doldu. Devam etmek için Krediler ekranından kredi satın alın.";
      }
      if (paywallReason === "free_monthly_limit") {
        return "Aylık ücretsiz limit doldu. Devam etmek için Krediler ekranından kredi satın alın.";
      }
      return "Yetersiz kredi. Yeni üretim başlatmak için kredi ekleyin.";
    }

    if (error.code === "SAFETY_HARD_BLOCK") {
      return "Metin güvenlik politikası nedeniyle engellendi.";
    }

    if (error.code === "SAFETY_SOFT_BLOCK") {
      return "Metin güvenlik nedeniyle düzenlenmeli. Daha güvenli bir ifade deneyin.";
    }

    if (error.code === "INTERNAL_ERROR") {
      return "Sunucu hatası oluştu. Kısa süre sonra tekrar deneyin.";
    }

    return error.message || "Üretim başlatılamadı.";
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Üretim başlatılırken beklenmeyen bir hata oluştu.";
}

export function GeneratorForm(): React.JSX.Element {
  const router = useRouter();
  const [text, setText] = useState("");
  const [requestedImageCount, setRequestedImageCount] = useState<GenerationRequestDto["requested_image_count"]>(2);
  const [creativeMode, setCreativeMode] = useState<GenerationRequestDto["creative_mode"]>("balanced");
  const [controls, setControls] = useState<ControlsState>({
    darkness: 0,
    calmness: 0,
    nostalgia: 0,
    cinematic: 1,
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [showActivation, setShowActivation] = useState(false);
  const [activationExperimentVariant, setActivationExperimentVariant] = useState("control");
  const [latestHistory, setLatestHistory] = useState<{
    generationId: string;
    activeRunState: string;
  } | null>(null);
  const showBillingCta =
    errorMessage !== null &&
    (errorMessage.includes("kredi") || errorMessage.includes("limit"));

  useEffect(() => {
    let cancelled = false;
    const loadActivation = async (): Promise<void> => {
      try {
        const history = await listGenerationHistory({
          limit: 1,
        });
        if (cancelled) {
          return;
        }
        const isNewUser = history.items.length === 0;
        const starterCardsEnabled = isFeatureEnabled("activation_starter_cards", {
          fallback: true,
        });
        setShowActivation(isNewUser && starterCardsEnabled);

        const experimentVariant = resolveExperimentVariant({
          key: "activation_starter_copy",
          fallbackVariant: "control",
        });
        setActivationExperimentVariant(experimentVariant);
        trackExperimentExposure({
          experimentKey: "activation_starter_copy",
          variant: experimentVariant,
        });
        const latest = history.items[0];
        if (latest !== undefined) {
          setLatestHistory({
            generationId: latest.generation_id,
            activeRunState: latest.active_run_state,
          });
          trackProductEventOnce("return_session_started", {
            latest_generation_id: latest.generation_id,
            latest_run_state: latest.active_run_state,
          });
        } else {
          setLatestHistory(null);
        }
      } catch {
        if (!cancelled) {
          setShowActivation(false);
          setLatestHistory(null);
        }
      }
    };

    void loadActivation();
    return () => {
      cancelled = true;
    };
  }, []);

  const submitGenerationPayload = async (
    payload: GenerationRequestDto,
    source: "manual" | "starter_auto",
  ): Promise<void> => {
    trackProductEvent("funnel_generate_submitted", {
      source,
      creative_mode: payload.creative_mode,
      requested_image_count: payload.requested_image_count,
    });
    const response = await createGeneration(payload);
    trackProductEventOnce("first_generation_created", {
      source,
      creative_mode: payload.creative_mode,
      requested_image_count: payload.requested_image_count,
    });
    trackProductEvent("funnel_generate_completed", {
      source,
      generation_id: response.generationId,
    });
    router.push(`/generations/${response.generationId}`);
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setErrorMessage(null);

    const payload = {
      text,
      requested_image_count: requestedImageCount,
      creative_mode: creativeMode,
      controls,
    };

    const parsed = generationRequestBodySchema.safeParse(payload);
    if (!parsed.success) {
      setErrorMessage("Form alanlarını kontrol edin. Metin ve görsel sayısı zorunludur.");
      return;
    }

    setSubmitting(true);
    try {
      await submitGenerationPayload(parsed.data, "manual");
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "INSUFFICIENT_CREDITS") {
        trackProductEvent("paywall_shown", {
          reason: (error.details?.paywall_reason as string | undefined) ?? "insufficient_credits",
        });
      }
      setErrorMessage(mapErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const updateControl = (key: keyof ControlsState, value: string): void => {
    setControls((current) => ({
      ...current,
      [key]: toControlValue(value),
    }));
  };

  const applyStarterPreset = (preset: StarterPreset): void => {
    setText(preset.text);
    setCreativeMode(preset.creativeMode);
    setControls(preset.controls);
    setRequestedImageCount(2);
    setErrorMessage(null);
    trackProductEvent("starter_prompt_used", {
      starter_id: preset.id,
      creative_mode: preset.creativeMode,
    });
  };

  const startWithStarterPreset = async (preset: StarterPreset): Promise<void> => {
    if (submitting) {
      return;
    }
    applyStarterPreset(preset);
    setSubmitting(true);
    try {
      await submitGenerationPayload(
        {
          text: preset.text,
          requested_image_count: 2,
          creative_mode: preset.creativeMode,
          controls: preset.controls,
        },
        "starter_auto",
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "INSUFFICIENT_CREDITS") {
        trackProductEvent("paywall_shown", {
          reason: (error.details?.paywall_reason as string | undefined) ?? "insufficient_credits",
        });
      }
      setErrorMessage(mapErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-[calc(100vh-7rem)] overflow-hidden">
      <div className="pointer-events-none absolute -left-12 top-10 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-12 top-32 h-64 w-64 rounded-full bg-cyan-400/15 blur-3xl" />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 pb-8 pt-4">
        {showActivation === false && latestHistory !== null ? (
          <ReturningSessionCard
            generationId={latestHistory.generationId}
            activeRunState={latestHistory.activeRunState}
            unfinished={!isTerminalRunState(latestHistory.activeRunState as Parameters<typeof isTerminalRunState>[0])}
            onContinue={() => {
              router.push(`/generations/${latestHistory.generationId}`);
            }}
          />
        ) : null}

        {showActivation ? (
          <StarterPrompts
            headline={
              activationExperimentVariant === "copy_b"
                ? "Hızlı başla, ilk güçlü sonucu hemen al"
                : "İlk üretimi başlat"
            }
            description={
              activationExperimentVariant === "copy_b"
                ? "Bir başlangıç seç, sonra varyasyonlarla sonucu güçlendir."
                : undefined
            }
            presets={starterPresets}
            onSelect={(presetId) => {
              const preset = starterPresets.find((entry) => entry.id === presetId);
              if (preset !== undefined) {
                applyStarterPreset(preset);
              }
            }}
            onGenerate={(presetId) => {
              const preset = starterPresets.find((entry) => entry.id === presetId);
              if (preset !== undefined) {
                void startWithStarterPreset(preset);
              }
            }}
          />
        ) : null}

        <form
          className="glass-panel soft-glow mx-auto w-full max-w-4xl rounded-[2rem] px-4 py-6 sm:px-8 sm:py-9"
          onSubmit={onSubmit}
        >
          <div className="mb-5 text-center">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
              Pixora yaratıcı yüzeyi
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Bir fikir başlat</h2>
          </div>

          <Textarea
            id="generation-text"
            placeholder="Ne üretmek istersin?"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className="min-h-[170px] border-none bg-transparent px-0 text-lg leading-relaxed text-white placeholder:text-muted-foreground/75 focus-visible:ring-0"
            maxLength={5000}
            required
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground/80">
            <span>Örn: yağmurlu bir şehirde yalnız bir adam, sinematik ışık</span>
            <span>{text.length}/5000</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground/75">Enter ile başlat · Shift+Enter yeni satır</p>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowControls((current) => !current)}
              className="rounded-full bg-white/7 px-4 text-white/90"
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Ayarlar
            </Button>

            <Button type="submit" disabled={submitting} className="rounded-full px-6 text-sm">
              {submitting ? "Pixora düşünüyor..." : "Üret"}
            </Button>
          </div>

          {showControls ? (
            <div className="mt-5 grid gap-3 rounded-2xl bg-white/6 p-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stil</p>
                <Select
                  value={creativeMode}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "fast" || value === "balanced" || value === "directed") {
                      setCreativeMode(value);
                    }
                  }}
                >
                  <option value="fast">Hızlı</option>
                  <option value="balanced">Dengeli</option>
                  <option value="directed">Yönlendirilmiş</option>
                </Select>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Atmosfer</p>
                <Select
                  value={`${controls.darkness}:${controls.calmness}`}
                  onChange={(event) => {
                    const [darknessRaw, calmnessRaw] = event.target.value.split(":");
                    setControls((current) => ({
                      ...current,
                      darkness: toControlValue(darknessRaw ?? "0"),
                      calmness: toControlValue(calmnessRaw ?? "0"),
                    }));
                  }}
                >
                  <option value="-1:2">Sakin</option>
                  <option value="0:0">Dengeli</option>
                  <option value="2:-1">Yoğun</option>
                  <option value="1:-2">Karanlık</option>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <p className="font-medium uppercase tracking-wide text-muted-foreground">Detay</p>
                  <span>{controls.cinematic}</span>
                </div>
                <input
                  id="control-detail"
                  type="range"
                  min={-2}
                  max={2}
                  step={1}
                  value={controls.cinematic}
                  onChange={(event) => updateControl("cinematic", event.target.value)}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15"
                />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Oran</p>
                <Select defaultValue="1:1" disabled>
                  <option value="1:1">1:1 (MVP)</option>
                </Select>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Varyant sayısı</p>
                <Select
                  value={String(requestedImageCount)}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    if (next >= 1 && next <= 4) {
                      setRequestedImageCount(next as GenerationRequestDto["requested_image_count"]);
                    }
                  }}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <p className="font-medium uppercase tracking-wide text-muted-foreground">Nostalji</p>
                  <span>{controls.nostalgia}</span>
                </div>
                <input
                  id="control-nostalgia"
                  type="range"
                  min={-2}
                  max={2}
                  step={1}
                  value={controls.nostalgia}
                  onChange={(event) => updateControl("nostalgia", event.target.value)}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15"
                />
              </div>
            </div>
          ) : null}

          {errorMessage !== null ? (
            <div className="mt-4 space-y-2">
              <p className="rounded-2xl bg-danger/15 px-3 py-2 text-sm text-danger">
                {errorMessage}
              </p>
              {showBillingCta ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    router.push("/billing");
                  }}
                >
                  Kredi satın al
                </Button>
              ) : null}
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
