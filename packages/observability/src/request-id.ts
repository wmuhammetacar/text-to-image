import { randomUUID } from "node:crypto";
import type { RequestIdFactory } from "@vi/application";

export class UuidRequestIdFactory implements RequestIdFactory {
  public create(): string {
    return randomUUID();
  }
}
