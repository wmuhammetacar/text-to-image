import type { LogContext } from "@vi/application";

export interface ErrorReporter {
  capture(params: {
    event: string;
    context: LogContext;
    timestamp: string;
  }): void;
}

interface SentryStoreReporterOptions {
  dsn: string;
  environment: string;
  release?: string;
}

interface ParsedSentryDsn {
  endpoint: string;
}

function parseSentryDsn(dsn: string): ParsedSentryDsn {
  const parsed = new URL(dsn);
  const projectId = parsed.pathname.replace(/^\/+/, "");
  if (projectId.length === 0 || parsed.username.length === 0) {
    throw new Error("SENTRY_DSN gecersiz.");
  }

  const endpoint = `${parsed.protocol}//${parsed.host}/api/${projectId}/store/?sentry_version=7&sentry_key=${encodeURIComponent(parsed.username)}`;
  return { endpoint };
}

export class SentryStoreReporter implements ErrorReporter {
  private readonly endpoint: string;
  private readonly environment: string;
  private readonly release?: string;

  public constructor(options: SentryStoreReporterOptions) {
    const parsed = parseSentryDsn(options.dsn);
    this.endpoint = parsed.endpoint;
    this.environment = options.environment;
    this.release = options.release;
  }

  public capture(params: {
    event: string;
    context: LogContext;
    timestamp: string;
  }): void {
    const body = {
      message: params.event,
      level: "error",
      logger: "pixora",
      platform: "node",
      timestamp: params.timestamp,
      environment: this.environment,
      release: this.release,
      extra: params.context,
      tags: {
        request_id:
          typeof params.context.requestId === "string"
            ? params.context.requestId
            : "unknown",
      },
    };

    void fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }).catch(() => {
      // Sentry teslim hatasi uygulama akisina etkimez.
    });
  }
}
