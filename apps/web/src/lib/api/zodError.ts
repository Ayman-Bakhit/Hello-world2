import type { ZodError } from "zod";
import { ApiClientError } from "./http";

/** Mock-mode validation failures look exactly like the API's structured 400 so the UI handles one shape. */
export function zodToClientError(err: ZodError): ApiClientError {
  const fields: Record<string, string[]> = {};
  for (const i of err.issues) (fields[i.path.length ? i.path.join(".") : "_"] ??= []).push(i.message);
  return new ApiClientError(400, "VALIDATION_ERROR", "Request validation failed", fields);
}
