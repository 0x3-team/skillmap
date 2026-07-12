export interface PublicCatalogFailure {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

export function classifyPublicCatalogFailure(error: unknown): PublicCatalogFailure {
  if (isCatalogInputError(error)) {
    return { status: 400, code: error.code, message: error.message, retryable: false };
  }
  if (isErrorCode(error, "SUPABASE_NOT_CONFIGURED")) {
    return {
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "The hosted catalog is not configured.",
      retryable: true
    };
  }
  // PostgREST turns an aborted custom fetch into an error result; the
  // repository intentionally redacts it as CatalogQueryError. All upstream
  // query failures are therefore transient 503s at the public boundary.
  if (isErrorCode(error, "CATALOG_QUERY_FAILED")) {
    return {
      status: 503,
      code: "CATALOG_UPSTREAM_UNAVAILABLE",
      message: "The hosted catalog is temporarily unavailable.",
      retryable: true
    };
  }
  return {
    status: 500,
    code: "CATALOG_UNAVAILABLE",
    message: "The hosted catalog is temporarily unavailable.",
    retryable: true
  };
}

function isCatalogInputError(
  error: unknown
): error is Error & { code: "INVALID_QUERY" | "INVALID_CURSOR" } {
  return isErrorCode(error, "INVALID_QUERY") || isErrorCode(error, "INVALID_CURSOR");
}

function isErrorCode<T extends string>(error: unknown, code: T): error is Error & { code: T } {
  return error instanceof Error && "code" in error && error.code === code;
}
