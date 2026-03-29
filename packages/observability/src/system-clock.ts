import type { Clock } from "@vi/application";

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}
