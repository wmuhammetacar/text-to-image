import type { GenerationDetailResponseDto } from "@vi/contracts";

export type RunState = GenerationDetailResponseDto["active_run_state"];

export interface RunStateUi {
  label: string;
  tone: "muted" | "default" | "success" | "warning" | "danger";
  description: string;
}

const stateUiMap: Record<RunState, RunStateUi> = {
  queued: {
    label: "Sırada",
    tone: "muted",
    description: "İstek kuyruğa alındı, worker tarafından işlenecek.",
  },
  analyzing: {
    label: "Analiz Ediliyor",
    tone: "default",
    description: "Metnin niyet ve duygu analizi yapılıyor.",
  },
  planning: {
    label: "Planlanıyor",
    tone: "default",
    description: "Görsel yön ve visual_plan hazırlanıyor.",
  },
  generating: {
    label: "Üretiliyor",
    tone: "default",
    description: "Varyantlar oluşturuluyor ve moderasyon uygulanıyor.",
  },
  refining: {
    label: "Refine Ediliyor",
    tone: "default",
    description: "Refinement_instruction ile yeni run işleniyor.",
  },
  completed: {
    label: "Tamamlandı",
    tone: "success",
    description: "Run başarıyla tamamlandı.",
  },
  partially_completed: {
    label: "Kısmi Tamamlandı",
    tone: "warning",
    description: "Bazı varyantlar üretildi, prorataya göre refund uygulanmış olabilir.",
  },
  failed: {
    label: "Başarısız",
    tone: "danger",
    description: "Run başarısız oldu. Kredi refund durumu run sonucuna göre işlendi.",
  },
  blocked: {
    label: "Engellendi",
    tone: "danger",
    description: "Güvenlik/moderasyon politikası nedeniyle run engellendi.",
  },
  refunded: {
    label: "Refundlandı",
    tone: "warning",
    description: "Run terminalde refundlandı.",
  },
};

export function getRunStateUi(state: RunState): RunStateUi {
  return stateUiMap[state];
}

export function getGenerationTerminalMessage(detail: GenerationDetailResponseDto): string | null {
  if (detail.active_run_state === "completed") {
    return "Üretim tamamlandı.";
  }

  if (detail.active_run_state === "partially_completed") {
    return "Üretim kısmi tamamlandı. Başarısız varyantlar için prorata refund uygulandı.";
  }

  if (detail.active_run_state === "blocked") {
    return "İçerik güvenlik politikası nedeniyle engellendi. Metni güvenli hale getirip tekrar deneyin.";
  }

  if (detail.active_run_state === "failed") {
    return "Üretim başarısız oldu. Otomatik retry/refund kuralları backend tarafından uygulandı.";
  }

  if (detail.active_run_state === "refunded") {
    return "Run refundlandı.";
  }

  return null;
}
