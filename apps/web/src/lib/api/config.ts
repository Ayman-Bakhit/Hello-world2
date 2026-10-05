export type ApiMode = "mock" | "api";

/** NEXT_PUBLIC_API_MODE=api switches the client to the real API. Anything else (including unset) is mock. */
export function resolveApiMode(value: string | undefined): ApiMode {
  return value === "api" ? "api" : "mock";
}

export const API_MODE: ApiMode = resolveApiMode(process.env.NEXT_PUBLIC_API_MODE);
export const API_BASE_URL: string = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").replace(/\/+$/, "");
