import type { ZodType, z } from "zod";
import { ApiError, zodFields } from "../errors";

/** Parse untrusted input with a Zod schema; throws a structured VALIDATION_ERROR. */
export function parse<S extends ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", zodFields(r.error));
  return r.data;
}

/**
 * Validate an outgoing body against its contract schema before sending, so the API cannot drift from
 * the shared contract the web client relies on. A mismatch is a server bug (500), never silently sent.
 */
export function respond<S extends ZodType>(schema: S, body: unknown): z.infer<S> {
  return schema.parse(body);
}
