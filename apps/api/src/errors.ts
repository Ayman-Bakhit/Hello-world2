import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`);

export function zodFields(err: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | ApiError | ZodError, req, reply) => {
    if (err instanceof ApiError) {
      if (err.statusCode === 401) void reply.header("www-authenticate", "Bearer");
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Request validation failed", fields: zodFields(err) } });
    }
    const status = (err as FastifyError).statusCode;
    if (status === 429) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests. Slow down and retry later." } });
    }
    if (status && status >= 400 && status < 500) {
      // Framework-level client errors (malformed JSON, oversized body, unsupported media type).
      return reply.code(status).send({ error: { code: "BAD_REQUEST", message: err.message } });
    }
    // Never leak internals. Log the error object only (no request body, no headers).
    req.log.error({ err: { name: err.name, message: err.message, stack: err.stack } }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } }));
}
