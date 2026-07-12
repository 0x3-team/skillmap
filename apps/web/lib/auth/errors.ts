import { isAuthSessionMissingError, type AuthError } from "@supabase/supabase-js";

const TERMINAL_SESSION_CODES = new Set([
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "user_not_found",
  "user_banned"
]);

export function shouldRedirectForAuthError(error: AuthError | null): boolean {
  if (!error || isAuthSessionMissingError(error)) return true;
  if (error.code && TERMINAL_SESSION_CODES.has(error.code)) return true;
  return error.status === 401 || error.status === 403;
}

export type VerifiedClaimsState =
  | { state: "authenticated"; userId: string }
  | { state: "signed-out" | "unavailable"; userId: null };

export function classifyVerifiedClaims(
  data: { claims?: { sub?: unknown } | null } | null,
  error: AuthError | null
): VerifiedClaimsState {
  const userId = data?.claims?.sub;
  if (typeof userId === "string" && userId.length > 0) return { state: "authenticated", userId };
  return shouldRedirectForAuthError(error)
    ? { state: "signed-out", userId: null }
    : { state: "unavailable", userId: null };
}
