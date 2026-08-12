import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  isConfirmationDecision,
  isConfirmationHandle,
  normalizeConfirmationRevision,
  normalizeConfirmationUserCode
} from "../lib/device-auth/confirmation-contracts.server.ts";
import { SupabaseDeviceAuthConfirmationRepository } from "../lib/device-auth/confirmation-repository.server.ts";
import { confirmationViewState } from "../app/device/confirmation-view-state.ts";

test("confirmation code normalization accepts only the emitted five-and-five grammar", () => {
  assert.equal(normalizeConfirmationUserCode("abcde-fghjk"), "ABCDE-FGHJK");
  assert.equal(normalizeConfirmationUserCode(" ABCDE-FGHJK "), "ABCDE-FGHJK");
  assert.equal(normalizeConfirmationUserCode("ABCDEFGHIJ"), null);
  assert.equal(normalizeConfirmationUserCode("ABCDE/FGHJK"), null);
  assert.equal(normalizeConfirmationUserCode("ABCDE-FGHJI"), null);
  assert.equal(normalizeConfirmationUserCode("ABCDE-FGHJK\n"), "ABCDE-FGHJK");
});

test("confirmation handle and revision validation reject raw codes and malformed values", () => {
  assert.equal(isConfirmationHandle("A".repeat(22)), true);
  assert.equal(isConfirmationHandle("ABCDE-FGHJK"), false);
  assert.equal(isConfirmationHandle("A".repeat(43)), false);
  assert.equal(normalizeConfirmationRevision("7"), 7);
  assert.equal(normalizeConfirmationRevision("07"), null);
  assert.equal(normalizeConfirmationRevision("0"), null);
  assert.equal(isConfirmationDecision("approve"), true);
  assert.equal(isConfirmationDecision("deny"), true);
  assert.equal(isConfirmationDecision("approved"), false);
});

test("repository exposes only sanitized review and terminal decision shapes", async () => {
  const calls = [];
  const repository = new SupabaseDeviceAuthConfirmationRepository({
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === "device_auth_review_my_pairing_v1") {
        return { data: {
          status: "reviewed",
          confirmation_handle: "A".repeat(22),
          confirmation_revision: 3,
          device: { name: "Desk Mac", platform: "macos", connector_version: "1.2.3", scopes: ["device.status"] }
        }, error: null };
      }
      return { data: { status: "approved" }, error: null };
    }
  });
  const reviewed = await repository.review("ABCDE-FGHJK");
  assert.deepEqual(reviewed, {
    status: "reviewed",
    handle: "A".repeat(22),
    revision: 3,
    device: { name: "Desk Mac", platform: "macos", connector_version: "1.2.3", scopes: ["device.status"] }
  });
  const approved = await repository.decide("A".repeat(22), 3, "approve");
  assert.deepEqual(approved, { status: "approved" });
  assert.deepEqual(calls, [
    { name: "device_auth_review_my_pairing_v1", params: { p_user_code: "ABCDE-FGHJK" } },
    { name: "device_auth_confirm_my_pairing_v1", params: { p_confirmation_handle: "A".repeat(22), p_confirmation_revision: 3, p_decision: "approve" } }
  ]);
});

test("repository rejects malformed or secret-bearing review rows before hidden fields are returned", async () => {
  const rows = [
    { status: "reviewed", confirmation_handle: "ABCDE-FGHJK", confirmation_revision: 1, device: { name: "Mac", platform: "macos", connector_version: "1.2.3", scopes: ["device.status"] } },
    { status: "reviewed", confirmation_handle: "A".repeat(22), confirmation_revision: 0, device: { name: "Mac", platform: "macos", connector_version: "1.2.3", scopes: ["device.status"] } },
    { status: "reviewed", confirmation_handle: "A".repeat(22), confirmation_revision: 1, device: { name: "Mac", platform: "macos", connector_version: "1.2.3", scopes: ["device.status", "device.status"] } },
    { status: "reviewed", confirmation_handle: "A".repeat(22), confirmation_revision: 1, device: { name: "Mac", platform: "macos", connector_version: "1.2.3", scopes: ["device.status"], device_code: "secret" } }
  ];
  for (const row of rows) {
    const repository = new SupabaseDeviceAuthConfirmationRepository({
      async rpc() { return { data: row, error: null }; }
    });
    assert.deepEqual(await repository.review("ABCDE-FGHJK"), { status: "unavailable" });
  }
});

test("confirmation view state has a real idle state and separates review/decision errors from terminals", () => {
  assert.equal(confirmationViewState({ status: "idle" }, { status: "idle" }), "idle");
  assert.equal(confirmationViewState({ status: "unavailable" }, { status: "idle" }), "review-error");
  const review = { status: "reviewed", handle: "A".repeat(22), revision: 1, device: { name: "Mac", platform: "macos", connector_version: "1.2.3", scopes: ["device.status"] } };
  assert.equal(confirmationViewState(review, { status: "unavailable" }), "decision-error");
  assert.equal(confirmationViewState(review, { status: "approved" }), "approved");
  assert.equal(confirmationViewState(review, { status: "denied" }), "denied");
  assert.equal(confirmationViewState(review, { status: "expired" }), "expired");
});

test("confirmation UI and server actions never use browser storage or query/hash code transport", async () => {
  const files = [
    "../app/device/page.tsx",
    "../app/device/actions.ts",
    "../app/device/device-confirmation-form.tsx"
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|location\.hash|searchParams.*userCode|userCode.*searchParams/);
  }
  const page = await readFile(new URL("../app/device/page.tsx", import.meta.url), "utf8");
  assert.match(page, /next=\/device/);
  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(page, /fetchCache = "force-no-store"/);
  assert.match(page, /referrer: "no-referrer"/);
  const form = await readFile(new URL("../app/device/device-confirmation-form.tsx", import.meta.url), "utf8");
  assert.match(form, /name="confirmationHandle"/);
  assert.doesNotMatch(form, /name="userCode"[^>]+value=\{review/);
});
