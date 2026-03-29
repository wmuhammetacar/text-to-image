import type { LogContext, Logger } from "@vi/application";
import type { ErrorReporter } from "./error-reporter";

const SENSITIVE_KEY_PATTERN = /(secret|password|token|authorization|cookie|api[-_]?key|service[-_]?role|dsn)/i;
const REDACTED = "[REDACTED]";

function sanitizeValue(
  value: unknown,
  keyHint: string | null,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (depth > 5) {
    return "[TRUNCATED]";
  }

  if (keyHint !== null && SENSITIVE_KEY_PATTERN.test(keyHint)) {
    return REDACTED;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: typeof value.stack === "string" ? value.stack.split("\n").slice(0, 6).join("\n") : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeValue(entry, keyHint, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }
    seen.add(value);

    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      out[key] = sanitizeValue(entry, key, depth + 1, seen);
    }
    return out;
  }

  return String(value);
}

export class JsonConsoleLogger implements Logger {
  public constructor(private readonly errorReporter?: ErrorReporter) {}

  public info(event: string, context: LogContext = {}): void {
    this.log("INFO", event, context);
  }

  public warn(event: string, context: LogContext = {}): void {
    this.log("WARN", event, context);
  }

  public error(event: string, context: LogContext = {}): void {
    this.log("ERROR", event, context);
  }

  private log(level: "INFO" | "WARN" | "ERROR", event: string, context: LogContext): void {
    const timestamp = new Date().toISOString();
    const sanitizedContext = sanitizeValue(context, null, 0, new WeakSet<object>());

    const payload = {
      ts: timestamp,
      level,
      event,
      ...(typeof sanitizedContext === "object" && sanitizedContext !== null
        ? (sanitizedContext as Record<string, unknown>)
        : {}),
    };
    const serialized = JSON.stringify(payload);
    if (level === "ERROR") {
      console.error(serialized);
      if (this.errorReporter !== undefined) {
        this.errorReporter.capture({
          event,
          context:
            typeof sanitizedContext === "object" && sanitizedContext !== null
              ? (sanitizedContext as LogContext)
              : {},
          timestamp,
        });
      }
      return;
    }
    console.log(serialized);
  }
}
