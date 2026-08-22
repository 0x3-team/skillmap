export type ImportConsentAction = (formData: FormData) => void | Promise<void>;

export type ImportConsentSubmissionResult =
  | { ok: true }
  | { ok: false; error: string; code: "IMPORT_CONSENT_UNAVAILABLE" | "IMPORT_CONSENT_FAILED" };

/** Runs the configured consent action without leaking rejected action details into the UI. */
export async function submitImportConsent(
  action: ImportConsentAction | undefined,
  formData: FormData
): Promise<ImportConsentSubmissionResult> {
  if (!action) {
    return {
      ok: false,
      error: "Consent is unavailable. Refresh and try again.",
      code: "IMPORT_CONSENT_UNAVAILABLE"
    };
  }
  try {
    await action(formData);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Consent could not be recorded. Refresh and try again.",
      code: "IMPORT_CONSENT_FAILED"
    };
  }
}
