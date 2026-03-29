"use client";

import { useState } from "react";
import {
  generationRequestBodySchema,
  type GenerationRequestDto,
} from "@vi/contracts";
import { useRouter } from "next/navigation";
import { ApiClientError, createGeneration } from "../../lib/api-client";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";

interface ControlsState {
  darkness: number;
  calmness: number;
  nostalgia: number;
  cinematic: number;
}

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
      const response = await createGeneration(parsed.data);
      router.push(`/generations/${response.generationId}`);
    } catch (error) {
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

  return (
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
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </p>
          ) : null}

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? "Üretim başlatılıyor..." : "Generate"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
