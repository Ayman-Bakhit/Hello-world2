import {
  AuthStatusResponse, LogoutResponse, NonceResponse, SessionResponse, VerifyRequest,
} from "@project-name/shared";
import { API_BASE_URL } from "./config";
import { requestJson } from "./http";

/**
 * Wallet sign-in endpoints. The session lives in an HttpOnly cookie set by the API: this code never sees,
 * stores, or sends a session secret: no browser storage APIs and no script-readable cookie are involved.
 */
export function createAuthApi(opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
  const baseUrl = (opts.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    status: () => requestJson(AuthStatusResponse, { baseUrl, fetchImpl, path: "/api/auth/status" }),
    requestNonce: (address: string) => requestJson(NonceResponse, { baseUrl, fetchImpl, method: "POST", path: "/api/auth/nonce", body: { address } }),
    verify: (body: VerifyRequest) => requestJson(SessionResponse, { baseUrl, fetchImpl, method: "POST", path: "/api/auth/verify", body }),
    getSession: () => requestJson(SessionResponse, { baseUrl, fetchImpl, path: "/api/auth/session" }),
    logout: () => requestJson(LogoutResponse, { baseUrl, fetchImpl, method: "POST", path: "/api/auth/logout" }),
  };
}
export const authApi = createAuthApi();
