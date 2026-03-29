import { createHash } from "node:crypto";

export function deterministicHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function deterministicInt(input: string, modulo: number): number {
  if (modulo <= 0) {
    throw new Error("MODULO_MUST_BE_POSITIVE");
  }
  const hash = deterministicHash(input);
  const prefix = hash.slice(0, 8);
  const parsed = Number.parseInt(prefix, 16);
  return parsed % modulo;
}

export function includesScenarioFlag(text: string, flag: "partial" | "retryable" | "hard_block"): boolean {
  return text.toLowerCase().includes(`[[${flag}]]`);
}
