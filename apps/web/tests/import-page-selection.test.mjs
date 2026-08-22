import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { selectImportDashboardProjection } from "../lib/import/dashboard-selection.ts";

function projection(sessionId, state, createdAt) {
  return { sessionId, state, createdAt };
}

test("import page reads the bounded dashboard set and selects an actionable session", async () => {
  const pageSource = await readFile(new URL("../app/import/page.tsx", import.meta.url), "utf8");

  assert.ok(pageSource.includes(".limit(20)"));
  assert.equal(pageSource.includes(".limit(1)"), false);
  assert.ok(pageSource.includes("sanitizedProjections"));
  assert.ok(pageSource.includes("selectImportDashboardProjection(consentedProjections)"));
});

test("import page overlays consent for every sanitized projection before selection", async () => {
  const pageSource = await readFile(new URL("../app/import/page.tsx", import.meta.url), "utf8");

  assert.ok(pageSource.includes("sanitizedProjections.map"));
  assert.ok(pageSource.includes("consentedSessionIds.has(projection.sessionId)"));
  assert.ok(pageSource.includes('state: "consented" as const'));
});

test("ready-for-consent is not hidden by a newer preview or partial session", () => {
  const selected = selectImportDashboardProjection([
    projection("imp_" + "1".repeat(32), "preview", "2026-08-21T12:03:00.000Z"),
    projection("imp_" + "2".repeat(32), "partial", "2026-08-21T12:02:00.000Z"),
    projection("imp_" + "3".repeat(32), "ready_for_consent", "2026-08-21T12:01:00.000Z")
  ]);

  assert.equal(selected?.sessionId, "imp_" + "3".repeat(32));
});

test("selection remains newest-first within the same workflow priority", () => {
  const selected = selectImportDashboardProjection([
    projection("imp_" + "1".repeat(32), "ready_for_consent", "2026-08-21T12:01:00.000Z"),
    projection("imp_" + "2".repeat(32), "ready_for_consent", "2026-08-21T12:02:00.000Z")
  ]);

  assert.equal(selected?.sessionId, "imp_" + "2".repeat(32));
});
