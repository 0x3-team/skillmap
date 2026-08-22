import assert from "node:assert/strict";
import { test } from "node:test";

import { submitImportConsent } from "../lib/import/consent-submission.ts";

test("consent submission fails closed when no action is configured", async () => {
  const result = await submitImportConsent(undefined, new FormData());
  assert.deepEqual(result, {
    ok: false,
    error: "Consent is unavailable. Refresh and try again.",
    code: "IMPORT_CONSENT_UNAVAILABLE"
  });
});

test("consent submission converts action rejection to a bounded retryable result", async () => {
  const result = await submitImportConsent(async () => {
    throw new Error("sensitive upstream detail");
  }, new FormData());
  assert.deepEqual(result, {
    ok: false,
    error: "Consent could not be recorded. Refresh and try again.",
    code: "IMPORT_CONSENT_FAILED"
  });
});

test("consent submission reports success after the action settles", async () => {
  let calls = 0;
  const result = await submitImportConsent(async () => {
    calls += 1;
  }, new FormData());
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true });
});
