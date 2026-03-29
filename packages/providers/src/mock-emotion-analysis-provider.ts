import type {
  EmotionAnalysisInput,
  EmotionAnalysisProvider,
  EmotionAnalysisResult,
} from "@vi/application";
import { deterministicHash, deterministicInt } from "./deterministic";

const EMOTIONS = ["joy", "melancholy", "awe", "tension", "serenity"] as const;
const ATMOSPHERES = ["misty", "cinematic", "minimal", "dramatic", "nostalgic"] as const;

export class MockEmotionAnalysisProvider implements EmotionAnalysisProvider {
  public async analyze(input: EmotionAnalysisInput): Promise<EmotionAnalysisResult> {
    const seed = `${input.generationId}:${input.runId}:${input.text}`;
    const emotionIndex = deterministicInt(seed, EMOTIONS.length);
    const atmosphereIndex = deterministicInt(`${seed}:atm`, ATMOSPHERES.length);
    const confidence = 0.65 + deterministicInt(`${seed}:confidence`, 30) / 100;

    return {
      providerName: "mock-emotion-analysis",
      modelName: "mock-emotion-v1",
      userIntent: {
        intentJson: {
          summary: input.text.slice(0, 220),
          dominant_emotion: EMOTIONS[emotionIndex],
        },
        confidence,
      },
      emotionAnalysis: {
        analysisJson: {
          dominant_emotion: EMOTIONS[emotionIndex],
          intensity: deterministicInt(`${seed}:intensity`, 10) + 1,
          atmosphere: ATMOSPHERES[atmosphereIndex],
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
