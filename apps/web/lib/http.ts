import { z } from "zod";
import { ValidationAppError } from "@vi/application";

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ValidationAppError("Request body JSON formatinda degil.");
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationAppError("Request body dogrulanamadi.", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function parseQuery<TSchema extends z.ZodTypeAny>(
  url: string,
  schema: TSchema,
): z.infer<TSchema> {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new ValidationAppError("Query parametreleri gecersiz.", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}
