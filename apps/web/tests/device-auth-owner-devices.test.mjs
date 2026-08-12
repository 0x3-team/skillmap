import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ownerDeviceActionInput,
  parseOwnerDeviceMutationResult,
  parseOwnerDevicesResult,
} from "../lib/device-auth/owner-devices-contracts.server.ts";
import {
  listOwnerDevices,
  renameOwnerDevice,
  revokeOwnerDevice,
} from "../lib/device-auth/owner-devices-repository.server.ts";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("M3.10 owner RPC migration is feature-off and owner-scoped", async () => {
  const sql = await read(
    "supabase/migrations/20260810060000_skillmap_device_auth_owner_devices.sql",
  );
  for (const name of [
    "api.device_auth_list_my_devices_v1",
    "api.device_auth_rename_my_device_v1",
    "api.device_auth_revoke_my_device_v1",
  ])
    assert.match(sql, new RegExp(name.replaceAll(".", "\\.")));
  assert.match(sql, /current_device_auth_is_permanent_user/);
  assert.match(sql, /current_request_uid/);
  assert.match(
    sql,
    /grant execute on function private\.current_request_uid\(\) to skillmap_device_auth_definer/,
  );
  assert.doesNotMatch(sql, /current_request_role/);
  assert.match(
    sql,
    /revoke all on function api\.device_auth_list_my_devices_v1/,
  );
  assert.match(
    sql,
    /revoke all on function api\.device_auth_rename_my_device_v1/,
  );
  assert.match(
    sql,
    /revoke all on function api\.device_auth_revoke_my_device_v1/,
  );
  assert.doesNotMatch(sql, /revoke[_ ]all[_ ]my[_ ]devices/i);
});

test("projection and UI do not expose secret-bearing fields or a current-device claim", async () => {
  const [sql, page, panel, repository] = await Promise.all([
    read(
      "supabase/migrations/20260810060000_skillmap_device_auth_owner_devices.sql",
    ),
    read("apps/web/app/account/devices/page.tsx"),
    read("apps/web/app/account/devices/devices-panel.tsx"),
    read("apps/web/lib/device-auth/owner-devices-repository.server.ts"),
  ]);
  const projection = sql.slice(
    sql.indexOf("return pg_catalog.jsonb_build_object("),
    sql.indexOf(
      "end\n$function$;",
      sql.indexOf("return pg_catalog.jsonb_build_object("),
    ),
  );
  for (const secret of [
    "account_id",
    "internal_uuid",
    "token_digest",
    "credential_digest",
    "proof",
    "public_key",
    "key_thumbprint",
    "replay",
  ]) {
    assert.doesNotMatch(
      projection,
      new RegExp(secret, "i"),
      `projection leaked ${secret}`,
    );
    assert.doesNotMatch(
      repository,
      new RegExp(secret, "i"),
      `repository mentioned ${secret}`,
    );
  }
  assert.doesNotMatch(`${page}\n${panel}`, /current\s*device/i);
  assert.match(`${page}\n${panel}`, /data-device-state="loading"/);
  assert.match(`${page}\n${panel}`, /data-device-state="signed-out"/);
  assert.match(`${page}\n${panel}`, /data-device-state="error"/);
  assert.match(panel, /role="alertdialog"/);
  assert.match(panel, /aria-modal="true"/);
  assert.match(panel, /event\.key === "Escape"/);
  assert.match(panel, /cancelRevokeRef\.current\?\.focus/);
  assert.match(panel, /querySelectorAll<HTMLElement>\(/);
  assert.match(panel, /Retry device action/);
  assert.match(panel, /could not be completed/);
  assert.match(panel, /startTransition\(async \(\) => \{[\s\S]*catch \{/);
  assert.match(
    panel,
    /key=\{`\$\{device\.publicIdSuffix\}:\$\{device\.revision\}`\}/,
  );
  assert.match(panel, /device\.state === "expiring"/);
  assert.match(panel, /Confirm revoke/);
  assert.match(panel, /aria-label={`Rename device/);
  assert.match(panel, /Match this ID with[\s\S]*skillmap auth status/);
  assert.match(panel, /min-w-0/);
});

test("contracts normalize UTF-8 names and fail closed on unsafe projections", () => {
  const decomposed = `Cafe\u0301`;
  assert.equal(ownerDeviceActionInput(`  ${decomposed}  `), "Café");
  assert.equal(ownerDeviceActionInput("x".repeat(65)), null);
  assert.equal(ownerDeviceActionInput("\u0000name"), null);
  const device = {
    public_id_suffix: "a1b2c3d4",
    display_name: "Café",
    platform: "macos",
    created_at: "2026-08-11T12:00:00.000Z",
    last_seen_at: null,
    expires_at: "2026-08-18T12:00:00.000Z",
    state: "expiring",
    scopes: ["device.route"],
    revision: 2,
  };
  assert.deepEqual(
    parseOwnerDevicesResult({ status: "ok", devices: [device] }).status,
    "ok",
  );
  assert.deepEqual(
    parseOwnerDeviceMutationResult({ status: "conflict", device }).status,
    "conflict",
  );
  assert.equal(
    parseOwnerDevicesResult({
      status: "ok",
      devices: [{ ...device, account_id: "leak" }],
    }).status,
    "unavailable",
    "unknown response fields fail closed",
  );
  assert.equal(
    parseOwnerDevicesResult({
      status: "ok",
      devices: [{ ...device, display_name: decomposed }],
    }).status,
    "unavailable",
  );
});

test("repository binds exact RPCs, revisions, and sanitized action inputs", async () => {
  const calls = [];
  const device = {
    public_id_suffix: "a1b2c3d4",
    display_name: "Café",
    platform: "macos",
    created_at: "2026-08-11T12:00:00.000Z",
    last_seen_at: null,
    expires_at: "2026-08-18T12:00:00.000Z",
    state: "expiring",
    scopes: ["device.route"],
    revision: 2,
  };
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data: name.includes("list")
          ? { status: "ok", devices: [device] }
          : { status: "ok", device },
        error: null,
      };
    },
  };
  assert.equal((await listOwnerDevices(supabase)).status, "ok");
  assert.equal(
    (await renameOwnerDevice(supabase, "a1b2c3d4", `Cafe\u0301`, 2)).status,
    "ok",
  );
  assert.equal((await revokeOwnerDevice(supabase, "a1b2c3d4", 2)).status, "ok");
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      "device_auth_list_my_devices_v1",
      "device_auth_rename_my_device_v1",
      "device_auth_revoke_my_device_v1",
    ],
  );
  assert.equal(calls[1].args.p_display_name, "Café");
  assert.equal(calls[1].args.p_expected_revision, 2);
  assert.deepEqual(await renameOwnerDevice(supabase, "foreign!", "name", 2), {
    status: "unavailable",
  });
});
