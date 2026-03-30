import type { GenerationDetailResponseDto } from "@vi/contracts";

export type RunState = GenerationDetailResponseDto["active_run_state"];
export type GeneratorLastActionType = "variation" | "upscale" | "refine";

export interface GeneratorLastAction {
  type: GeneratorLastActionType;
  label: string;
  runId: string;
}

export interface GeneratorUiState {
  selectedVariantId: string | null;
  loadingVariantId: string | null;
  lastAction: GeneratorLastAction | null;
}

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

export function createGeneratorUiState(initialSelectedVariantId: string | null): GeneratorUiState {
  return {
    selectedVariantId: initialSelectedVariantId,
    loadingVariantId: null,
    lastAction: null,
  };
}

export function setSelectedVariant(
  state: GeneratorUiState,
  selectedVariantId: string | null,
): GeneratorUiState {
  return {
    ...state,
    selectedVariantId,
  };
}

export function setLoadingVariant(
  state: GeneratorUiState,
  loadingVariantId: string | null,
): GeneratorUiState {
  return {
    ...state,
    loadingVariantId,
  };
}

export function setLastAction(
  state: GeneratorUiState,
  lastAction: GeneratorLastAction | null,
): GeneratorUiState {
  return {
    ...state,
    lastAction,
  };
}

export function getLoadingExperienceMessage(detail: {
  active_run_state: GenerationDetailResponseDto["active_run_state"];
  passes: GenerationDetailResponseDto["passes"];
}): string | null {
  if (isTerminalRunState(detail.active_run_state)) {
    return null;
  }

  if (detail.active_run_state === "queued") {
    return "Sırada bekliyor, işlem kaydı worker tarafından alınacak.";
  }

  if (detail.active_run_state === "analyzing") {
    return "AI düşünüyor: metin niyeti ve duygusal katman çözülüyor.";
  }

  if (detail.active_run_state === "planning") {
    return "Sahne kuruluyor...";
  }

  if (detail.active_run_state === "refining") {
    return "Önceki sonuç korunuyor, yeni yaratıcı yön hazırlanıyor...";
  }

  if (detail.active_run_state !== "generating") {
    return "Görsel üretim akışı devam ediyor...";
  }

  const activePass = detail.passes
    .slice()
    .sort((a, b) => a.pass_index - b.pass_index)
    .find((pass) => pass.status === "running") ??
    detail.passes
      .slice()
      .sort((a, b) => a.pass_index - b.pass_index)
      .find((pass) => pass.status === "queued");

  if (activePass?.pass_type === "concept") {
    return "Sahne kuruluyor...";
  }

  if (activePass?.pass_type === "composition") {
    return "Kadraj ve perspektif ayarlanıyor...";
  }

  if (activePass?.pass_type === "detail") {
    return "Detaylar işleniyor...";
  }

  if (activePass?.pass_type === "enhancement") {
    return "Son dokunuşlar yapılıyor...";
  }

  return "AI düşünüyor ve görüntüleri finalize ediyor...";
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

function isTerminalRunState(state: RunState): boolean {
  return (
    state === "completed" ||
    state === "partially_completed" ||
    state === "failed" ||
    state === "blocked" ||
    state === "refunded"
  );
}
