import type {
  Clock,
  IdFactory,
  LogContext,
  Logger,
  RequestIdFactory,
} from "@vi/application";

export class NoopLogger implements Logger {
  public readonly entries: Array<{ level: "info" | "warn" | "error"; event: string; context: LogContext }> = [];

  public info(event: string, context: LogContext = {}): void {
    this.entries.push({ level: "info", event, context });
  }

  public warn(event: string, context: LogContext = {}): void {
    this.entries.push({ level: "warn", event, context });
  }

  public error(event: string, context: LogContext = {}): void {
    this.entries.push({ level: "error", event, context });
  }
}

export class FixedClock implements Clock {
  private nowValue: Date;

  public constructor(initial: Date) {
    this.nowValue = initial;
  }

  public now(): Date {
    return new Date(this.nowValue);
  }

  public advanceMs(ms: number): void {
    this.nowValue = new Date(this.nowValue.getTime() + ms);
  }
}

export class SequenceIdFactory implements IdFactory {
  private readonly values: string[];
  private offset = 0;

  public constructor(values: string[]) {
    this.values = values;
  }

  public createUuid(): string {
    const current = this.values[this.offset];
    if (current === undefined) {
      throw new Error("ID_SEQUENCE_EXHAUSTED");
    }
    this.offset += 1;
    return current;
  }
}

export class SequenceRequestIdFactory implements RequestIdFactory {
  private readonly values: string[];
  private offset = 0;

  public constructor(values: string[]) {
    this.values = values;
  }

  public create(): string {
    const current = this.values[this.offset];
    if (current === undefined) {
      throw new Error("REQUEST_ID_SEQUENCE_EXHAUSTED");
    }
    this.offset += 1;
    return current;
  }
}
