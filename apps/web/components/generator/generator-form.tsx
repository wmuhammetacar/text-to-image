"use client";

import { useEffect, useState } from "react";
import {
  generationRequestBodySchema,
  type GenerationRequestDto,
} from "@vi/contracts";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
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
    <div className="space-y-4">
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

      <Card>
        <CardHeader>
          <CardTitle>Yeni Üretim</CardTitle>
          <CardDescription>
            Metni yazın, sistem duygusal katmanı analiz ederek çoklu görsel varyant üretsin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="generation-text">Metin</Label>
            <Textarea
              id="generation-text"
              placeholder="Örn: Çocukluk anılarımı çağrıştıran, sisli bir sabah atmosferinde sinematik bir sahne üret"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={5000}
              required
            />
            <p className="text-xs text-muted-foreground">{text.length}/5000</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="requested-image-count">Görsel Sayısı</Label>
              <Select
                id="requested-image-count"
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
              <Label htmlFor="creative-mode">Creative Mode</Label>
              <Select
                id="creative-mode"
                value={creativeMode}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "fast" || value === "balanced" || value === "directed") {
                    setCreativeMode(value);
                  }
                }}
              >
                <option value="fast">fast</option>
                <option value="balanced">balanced</option>
                <option value="directed">directed</option>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Kontroller</h4>
            <div className="grid gap-4 md:grid-cols-2">
              {([
                ["darkness", "Karanlık"],
                ["calmness", "Sakinlik"],
                ["nostalgia", "Nostalji"],
                ["cinematic", "Sinematik"],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <Label htmlFor={`control-${key}`}>{label}</Label>
                    <span className="text-muted-foreground">{controls[key]}</span>
                  </div>
                  <input
                    id={`control-${key}`}
                    type="range"
                    min={-2}
                    max={2}
                    step={1}
                    value={controls[key]}
                    onChange={(event) => updateControl(key, event.target.value)}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary"
                  />
                </div>
              ))}
            </div>
          </div>

          {errorMessage !== null ? (
            <div className="space-y-2">
              <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
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

            <Button type="submit" fullWidth disabled={submitting}>
              {submitting ? "Üretim başlatılıyor..." : "Generate"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
