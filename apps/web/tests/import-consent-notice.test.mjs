import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("M4 import page renders bounded consent redirect feedback", async () => {
  const pageSource = await readFile(new URL("../app/import/page.tsx", import.meta.url), "utf8");

  assert.ok(pageSource.includes("searchParams"));
  assert.ok(pageSource.includes('"invalid-consent"'));
  assert.ok(pageSource.includes('"consent-conflict"'));
  assert.ok(pageSource.includes("notice={notice}"));
});
