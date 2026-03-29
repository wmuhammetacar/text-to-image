import type { ModerationDecision } from "./states";

export interface ModerationOutcome {
  decision: ModerationDecision;
  policyCode: string;
  userMessage: string | null;
  sanitizedText?: string;
}

export function moderationUserMessage(decision: ModerationDecision): string | null {
  switch (decision) {
    case "allow":
      return null;
    case "sanitize":
      return "Istek guvenlik kurallarina gore duzenlendi.";
    case "soft_block":
      return "Istegi duzenleyip tekrar gonderin.";
    case "hard_block":
      return "Bu istek guvenlik politikasi nedeniyle islenemez.";
    case "review":
      return "Istek guvenli bicimde yeniden yazilmalidir.";
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}
