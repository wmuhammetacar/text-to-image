import type {
  EmotionAnalysisInput,
  EmotionAnalysisProvider,
  EmotionAnalysisResult,
} from "@vi/application";
import { deterministicHash, deterministicInt } from "./deterministic";

const EMOTIONS = ["joy", "melancholy", "awe", "tension", "serenity"] as const;
const ATMOSPHERES = ["misty", "cinematic", "minimal", "dramatic", "nostalgic"] as const;
const THEMES = ["memory", "urban", "nature", "solitude", "momentum"] as const;

export class MockEmotionAnalysisProvider implements EmotionAnalysisProvider {
  public async analyze(input: EmotionAnalysisInput): Promise<EmotionAnalysisResult> {
    const seed = `${input.generationId}:${input.runId}:${input.text}`;
    const emotionIndex = deterministicInt(seed, EMOTIONS.length);
    const atmosphereIndex = deterministicInt(`${seed}:atm`, ATMOSPHERES.length);
    const secondaryEmotionIndex = deterministicInt(`${seed}:secondary`, EMOTIONS.length);
    const themeIndex = deterministicInt(`${seed}:theme`, THEMES.length);
    const confidence = 0.65 + deterministicInt(`${seed}:confidence`, 30) / 100;

    return {
      providerName: "mock-emotion-analysis",
      modelName: "mock-emotion-v1",
      userIntent: {
        intentJson: {
          summary: input.text.slice(0, 220),
          visual_goal: "emotion-resonant visual storytelling",
          narrative_intent: "translate text into emotionally coherent composition",
          style_hints: [ATMOSPHERES[atmosphereIndex]],
          forbidden_elements: [],
          subjects: input.text
            .split(/\s+/)
            .map((token) => token.replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]/gi, "").toLowerCase())
            .filter((token) => token.length >= 4)
            .slice(0, 4),
          dominant_emotion: EMOTIONS[emotionIndex],
        },
        confidence,
      },
      emotionAnalysis: {
        analysisJson: {
          dominant_emotion: EMOTIONS[emotionIndex],
          secondary_emotions: [EMOTIONS[secondaryEmotionIndex]],
          intensity: deterministicInt(`${seed}:intensity`, 10) + 1,
          valence: (deterministicInt(`${seed}:valence`, 200) - 100) / 100,
          arousal: deterministicInt(`${seed}:arousal`, 100) / 100,
          emotional_tone: EMOTIONS[emotionIndex],
          atmosphere: [ATMOSPHERES[atmosphereIndex]],
          themes: [THEMES[themeIndex]],
        },
      },
      providerRequestRedacted: {
        text_hash: deterministicHash(input.text),
      },
      providerResponseRedacted: {
        dominant_emotion: EMOTIONS[emotionIndex],
        atmosphere: ATMOSPHERES[atmosphereIndex],
      },
    };
  }
}
