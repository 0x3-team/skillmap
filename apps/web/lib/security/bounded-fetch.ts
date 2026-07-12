export const PUBLIC_CATALOG_TIMEOUT_MS = 8_000;

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export class CatalogFetchAbortError extends Error {
  readonly code = "ABORT_ERR";

  constructor(message: string) {
    super(message);
    this.name = "AbortError";
  }
}

export function createBoundedCatalogFetch(options: {
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
} = {}): FetchImplementation {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? PUBLIC_CATALOG_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("The public catalog timeout must be an integer from 1 to 60000 milliseconds.");
  }

  return async (input, init = {}) => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeExternalAbortListener: (() => void) | undefined;

    const boundary = new Promise<never>((_resolve, reject) => {
      const abort = (error: CatalogFetchAbortError) => {
        reject(error);
        controller.abort(error);
      };
      timeout = setTimeout(
        () => abort(new CatalogFetchAbortError("The public catalog upstream request timed out.")),
        timeoutMs
      );

      if (init.signal) {
        const onAbort = () => abort(new CatalogFetchAbortError("The public catalog upstream request was aborted."));
        if (init.signal.aborted) onAbort();
        else {
          init.signal.addEventListener("abort", onAbort, { once: true });
          removeExternalAbortListener = () => init.signal?.removeEventListener("abort", onAbort);
        }
      }
    });

    try {
      return await Promise.race([
        fetchImplementation(input, { ...init, cache: "no-store", signal: controller.signal }),
        boundary
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      removeExternalAbortListener?.();
    }
  };
}
