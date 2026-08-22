import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("read-only import dashboard routes device-proof resume and exclusion work back to the CLI", async () => {
  const clientSource = await readFile(new URL("../app/import/import-review-client.tsx", import.meta.url), "utf8");

  assert.ok(clientSource.includes("Return to the CLI to exclude blocked skills"));
  assert.ok(clientSource.includes("Return to the CLI to safely resume this upload"));
  assert.ok(clientSource.includes("skillmap import vault <skill-path>"));
  assert.ok(clientSource.includes("To cancel, stop the local command and let the session expire"));
  assert.ok(clientSource.includes("cannot resume or cancel device-auth sessions"));
  assert.ok(clientSource.includes("const cliCommand = MANAGED_IMPORT_COMMAND"));
  assert.equal((clientSource.match(/\{CLI_RECOVERY_MESSAGE\}/g) ?? []).length, 1);
  assert.ok(clientSource.includes("router.refresh()"));
  assert.equal(clientSource.includes("Resume Upload"), false);
  assert.equal(clientSource.includes("Cancel Import"), false);
  assert.equal(clientSource.includes("onResumeAction"), false);
  assert.equal(clientSource.includes("onCancelAction"), false);
  assert.equal(clientSource.includes("onRefreshAction"), false);
  assert.equal(clientSource.includes("you may exclude them below to proceed"), false);
  assert.equal(clientSource.includes("You can safely resume."), false);
});
