export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  const typed = value as Record<string, unknown>;
  const keys = Object.keys(typed).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(typed[key])}`);
  return `{${pairs.join(",")}}`;
}

export function deepEqualJson(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}
