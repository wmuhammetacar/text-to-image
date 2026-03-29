import type {
  InputModerationResult,
  OutputModerationInput,
  OutputModerationResult,
  SafetyShapingInput,
  SafetyShapingProvider,
  SafetyShapingResult,
} from "@vi/application";
import { includesScenarioFlag } from "./deterministic";

const HARD_BLOCK_KEYWORDS = ["terror", "child abuse", "extremism"];
const SOFT_BLOCK_KEYWORDS = ["self-harm", "suicide"]; 
const SANITIZE_KEYWORDS = ["blood", "violence", "weapon"];

function normalize(text: string): string {
  return text.toLowerCase();
}

function containsAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

function sanitizeText(text: string): string {
  return text
    .replace(/blood/gi, "red tone")
    .replace(/violence/gi, "intense motion")
    .replace(/weapon/gi, "object");
}

export class MockSafetyShapingProvider implements SafetyShapingProvider {
  public async moderateInputText(text: string): Promise<InputModerationResult> {
    const lowered = normalize(text);

    if (includesScenarioFlag(lowered, "hard_block") || containsAny(lowered, HARD_BLOCK_KEYWORDS)) {
      return {
        stage: "input_moderation",
        decision: "hard_block",
        policyCode: "INPUT_HARD_BLOCK",
        message: "Icerik guvenlik nedeniyle engellendi.",
        sanitizedText: text,
      };
    }

    if (containsAny(lowered, SOFT_BLOCK_KEYWORDS)) {
      return {
        stage: "input_moderation",
        decision: "soft_block",
        policyCode: "INPUT_SOFT_BLOCK",
        message: "Icerik duzenlenmeli.",
        sanitizedText: text,
      };
    }

    if (containsAny(lowered, SANITIZE_KEYWORDS)) {
      return {
        stage: "input_moderation",
        decision: "sanitize",
        policyCode: "INPUT_SANITIZE",
        message: "Istek guvenlik kurallarina gore duzenlendi.",
        sanitizedText: sanitizeText(text),
      };
    }

    return {
      stage: "input_moderation",
      decision: "allow",
      policyCode: "INPUT_ALLOW",
      message: null,
      sanitizedText: text,
    };
  }

  public async shapeBeforeGeneration(input: SafetyShapingInput): Promise<SafetyShapingResult> {
    const lowered = normalize(input.sourceText);

    if (includesScenarioFlag(lowered, "hard_block") || containsAny(lowered, HARD_BLOCK_KEYWORDS)) {
      return {
        providerName: "mock-safety-shaping",
        decision: "hard_block",
        policyCode: "PRE_GEN_HARD_BLOCK",
        message: "Uretim oncesi guvenlik engeli.",
        shapedText: input.sourceText,
        providerRequestRedacted: { has_visual_plan: true },
        providerResponseRedacted: { decision: "hard_block" },
      };
    }

    if (containsAny(lowered, SANITIZE_KEYWORDS)) {
      const shaped = sanitizeText(input.sourceText);
      return {
        providerName: "mock-safety-shaping",
        decision: "sanitize",
        policyCode: "PRE_GEN_SANITIZE",
        message: "Prompt guvenli sekilde sekillendirildi.",
        shapedText: shaped,
        providerRequestRedacted: { has_visual_plan: true },
        providerResponseRedacted: { decision: "sanitize" },
      };
    }

    return {
      providerName: "mock-safety-shaping",
      decision: "allow",
      policyCode: "PRE_GEN_ALLOW",
      message: null,
      shapedText: input.sourceText,
      providerRequestRedacted: { has_visual_plan: true },
      providerResponseRedacted: { decision: "allow" },
    };
  }

  public async moderateOutput(input: OutputModerationInput): Promise<OutputModerationResult> {
    const loweredPath = input.variant.storagePath.toLowerCase();

    if (loweredPath.includes("unsafe")) {
      return {
        decision: "hard_block",
        policyCode: "OUTPUT_HARD_BLOCK",
        message: "Gorsel cikti guvenlik nedeniyle engellendi.",
      };
    }

    return {
      decision: "allow",
      policyCode: "OUTPUT_ALLOW",
      message: null,
    };
  }
}
