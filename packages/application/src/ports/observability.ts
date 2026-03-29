export interface LogContext {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  generationId?: string;
  runId?: string;
  jobId?: string;
  [key: string]: unknown;
}

export interface Logger {
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
}

export interface RequestIdFactory {
  create(): string;
}

export interface Clock {
  now(): Date;
}

export interface IdFactory {
  createUuid(): string;
}
