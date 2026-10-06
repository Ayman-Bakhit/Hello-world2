import { ApiErrorBody } from "@project-name/shared";
import type { z } from "zod";

export class ApiClientError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly fields?: Record<string, string[]>) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface RequestOptions {
  baseUrl: string;
  fetchImpl: typeof fetch;
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Optional bearer token (dev/API clients). Browsers authenticate with the HttpOnly cookie instead. */
  token?: string | null;
}

/**
 * One place that talks HTTP to the API: sends the session cookie (credentials: include), parses structured
 * errors, and validates every successful response against its shared Zod schema.
 */
export async function requestJson<S extends z.ZodType>(schema: S, o: RequestOptions): Promise<z.infer<S>> {
  const url = new URL(`${o.baseUrl}${o.path}`);
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await o.fetchImpl(url.toString(), {
      method: o.method ?? "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(o.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "Could not reach the API");
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ApiErrorBody.safeParse(json);
    throw e.success
      ? new ApiClientError(res.status, e.data.error.code, e.data.error.message, e.data.error.fields)
      : new ApiClientError(res.status, "HTTP_ERROR", `Request failed (${res.status})`);
  }
  return schema.parse(json);
}
