import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("read-only import dashboard routes device-proof resume and exclusion work back to the CLI", async () => {
  const clientSource = await readFile(new URL("../app/import/import-review-client.tsx", import.meta.url), "utf8");

  assert.ok(clientSource.includes("Return to the CLI to exclude blocked skills"));
  assert.ok(clientSource.includes("Return to the CLI to safely resume this upload"));
  assert.equal(clientSource.includes("you may exclude them below to proceed"), false);
  assert.equal(clientSource.includes("You can safely resume."), false);
});
