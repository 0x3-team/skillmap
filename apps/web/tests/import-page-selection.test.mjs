import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sanitizeImportDashboardRows,
  selectImportDashboardProjection
} from "../lib/import/dashboard-selection.ts";

function projection(sessionId, state, createdAt) {
  return { sessionId, state, createdAt };
}

test("dashboard rows are sanitized behaviorally and malformed rows are dropped", () => {
  const sessionId = "imp_" + "1".repeat(32);
  const rows = sanitizeImportDashboardRows([
    { unrelated: true },
    { projection: null },
    {
      projection: {
        sessionId,
        state: "preview",
        device: { name: "Connector" },
        summary: { manifestDigest: "sha256:" + "a".repeat(64) },
        skills: [],
        createdAt: "2026-08-21T12:00:00.000Z",
        expiresAt: "2026-08-21T13:00:00.000Z",
        revision: 1,
        token: "must-not-survive"
      }
    }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, sessionId);
  assert.equal("token" in rows[0], false);
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

test("a completed cutover receipt remains visible ahead of preview noise", () => {
  const selected = selectImportDashboardProjection([
    projection("imp_" + "1".repeat(32), "preview", "2026-08-21T12:03:00.000Z"),
    projection("imp_" + "2".repeat(32), "cutover_ready", "2026-08-21T12:01:00.000Z")
  ]);

  assert.equal(selected?.sessionId, "imp_" + "2".repeat(32));
});
