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
    id: "cinematic_city",
    label: "Cinematic Şehir",
    text: "Yağmurdan sonra neon ışıklarla parlayan bir şehirde yalnız bir karakter, dramatik sinematik atmosfer.",
    creativeMode: "directed",
    controls: {
      darkness: 1,
      calmness: 0,
      nostalgia: 0,
      cinematic: 2,
    },
  },
  {
    id: "dreamy_memory",
    label: "Dreamy Anı",
    text: "Çocukluk yaz akşamını anımsatan, yumuşak ışıklı ve nostaljik bir sahne.",
    creativeMode: "balanced",
    controls: {
      darkness: -1,
      calmness: 2,
      nostalgia: 2,
      cinematic: 1,
    },
  },
  {
    id: "surreal_portrait",
    label: "Sürreal Portre",
    text: "Gerçeküstü renk geçişleriyle yüksek kontrastlı bir portre; güçlü duygu yoğunluğu ve sembolik arka plan.",
    creativeMode: "directed",
    controls: {
      darkness: 0,
      calmness: -1,
      nostalgia: 0,
      cinematic: 2,
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
        return "Günlük ücretsiz limit doldu. Devam etmek için Billing ekranından kredi satın alın.";
      }
      if (paywallReason === "free_monthly_limit") {
        return "Aylık ücretsiz limit doldu. Devam etmek için Billing ekranından kredi satın alın.";
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
      trackProductEvent("funnel_generate_submitted", {
        creative_mode: parsed.data.creative_mode,
        requested_image_count: parsed.data.requested_image_count,
      });
      const response = await createGeneration(parsed.data);
      trackProductEventOnce("first_generation_created", {
        creative_mode: parsed.data.creative_mode,
        requested_image_count: parsed.data.requested_image_count,
      });
      trackProductEvent("funnel_generate_completed", {
        generation_id: response.generationId,
      });
      router.push(`/generations/${response.generationId}`);
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
                ? "Hazır başla, ilk WOW sonucu 30 saniyede al"
                : "İlk üretimi başlat"
            }
            description={
              activationExperimentVariant === "copy_b"
                ? "Bu preset'lerden biriyle hızlıca üret, sonra variation/upscale ile kaliteyi yükselt."
                : undefined
            }
            presets={starterPresets}
            onSelect={(presetId) => {
              const preset = starterPresets.find((entry) => entry.id === presetId);
              if (preset !== undefined) {
                applyStarterPreset(preset);
              }
            }}
          />
        ) : null}

        <form
          className="glass-panel soft-glow mx-auto w-full max-w-4xl rounded-[2rem] px-4 py-5 sm:px-8 sm:py-8"
          onSubmit={onSubmit}
        >
          <div className="mb-6 text-center">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
              AI Creative Canvas
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Ne üretmek istediğini yaz, gerisini Pixora düşünsün
            </h2>
          </div>

          <Textarea
            id="generation-text"
            placeholder="Describe what you want to create..."
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className="min-h-[160px] border-none bg-transparent px-0 text-lg text-white placeholder:text-muted-foreground/75 focus-visible:ring-0"
            maxLength={5000}
            required
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Enter ile üretim başlatılır · Shift+Enter yeni satır</span>
            <span>{text.length}/5000</span>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowControls((current) => !current)}
              className="rounded-full bg-white/7 px-4"
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Kontroller
            </Button>

            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">Tek ana aksiyon</span>
              <Button
                type="submit"
                disabled={submitting}
                className="rounded-full px-6 text-sm"
              >
                {submitting ? "AI üretiyor..." : "Generate"}
              </Button>
            </div>
          </div>

          {showControls ? (
            <div className="mt-5 grid gap-3 rounded-2xl bg-white/6 p-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Style</p>
                <Select
                  value={creativeMode}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "fast" || value === "balanced" || value === "directed") {
                      setCreativeMode(value);
                    }
                  }}
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="directed">Directed</option>
                </Select>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mood</p>
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
                  <option value="-1:2">Calm</option>
                  <option value="0:0">Neutral</option>
                  <option value="2:-1">Intense</option>
                  <option value="1:-2">Dark</option>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <p className="font-medium uppercase tracking-wide text-muted-foreground">Detail</p>
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
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ratio</p>
                <Select defaultValue="1:1" disabled>
                  <option value="1:1">1:1 (MVP)</option>
                </Select>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Image Count</p>
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
                  <p className="font-medium uppercase tracking-wide text-muted-foreground">Nostalgia</p>
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
