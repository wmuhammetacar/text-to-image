import { randomUUID } from "node:crypto";
import type { IdFactory } from "@vi/application";

export class UuidIdFactory implements IdFactory {
  public createUuid(): string {
    return randomUUID();
  }
}
