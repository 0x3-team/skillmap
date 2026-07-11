import { isAuthSessionMissingError, type AuthError } from "@supabase/supabase-js";

export function shouldRedirectForAuthError(error: AuthError | null): boolean {
  if (!error || isAuthSessionMissingError(error)) return true;
  return typeof error.status === "number" && error.status >= 400 && error.status < 500;
}
