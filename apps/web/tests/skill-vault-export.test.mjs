import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Focused M2.13 test for the account export route's managed Skill Vault
// integration. Follows the repo's established hosting-boundary pattern
// (hosted-boundaries.test.mjs): static source-assertion testing of the route,
// because the route imports "@/" aliases and Next "server-only" modules with no
// Node loader, so true execution-based mocking is not runnable here. Each test
// reads the route source once and asserts the committed security/safety contract.

const ROUTE = new URL("../app/account/export/route.ts", import.meta.url);

async function routeSource() {
  return readFile(ROUTE, "utf8");
}
test("export route stays authenticated owner-only and never accepts an account id", async () => {
  const source = await routeSource();
  assert.match(source, /export async function GET\(\)/);
  assert.match(source, /auth\.getClaims\(\)/);
  assert.match(source, /classifyVerifiedClaims\(claims, claimsError\)/);
  assert.match(source, /auth\.state\s*===\s*"signed-out"/);
  assert.match(source, /auth\.state\s*!==\s*"authenticated"/);
  assert.match(source, /from\("saved_skills"\)\.select\([^)]*\)\.eq\("user_id", auth\.userId\)/);
  assert.doesNotMatch(source, /getSearchParams\(\)?["']?\s*\.\s*get\(["']?(?:account|userId|user_id)/);
  assert.doesNotMatch(source, /accountId|user_id\s*=/);
  // The RPC is invoked with no arguments — never a caller-supplied account id.
  // The "as never" cast is a type-escape for the not-yet-regenerated RPC types
  // (M2.15); it must never smuggle a second argument.
  assert.doesNotMatch(source, /\.rpc\([^)]*export_my_managed_skill_vault[^)]*,\s*[^)]/);
  assert.match(source, /\.rpc\(EXPORT_MANAGED_VAULT_RPC as never\)/);
});

test("export route emits exact no-store, fixed content-type cache semantics", async () => {
  const source = await routeSource();
  assert.match(source, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(source, /"Pragma": "no-cache"/);
  assert.match(source, /"X-Content-Type-Options": "nosniff"/);
  assert.match(source, /"Content-Type": "application\/json; charset=utf-8"/);
  assert.match(source, /new Response\(body,/);
  assert.doesNotMatch(source, /no-cache(?!\b)/);
});

test("successful export includes the bounded, validated managed Skill Vault under a stable field", async () => {
  const source = await routeSource();
  assert.match(source, /managedSkillVault:\s*managedVaultResult\.data/);
  assert.match(source, /EXPORT_MANAGED_VAULT_RPC\s*=\s*"export_my_managed_skill_vault"/);
  assert.match(source, /EXPECTED_VAULT_SCHEMA_VERSION\s*=\s*"1\.0"/);
  assert.match(source, /\.rpc\(EXPORT_MANAGED_VAULT_RPC as never\)/);
  assert.match(source, /isValidManagedVault\(/);
  assert.match(source, /managedSkillVault/);
});

test("managed vault result is validated as a bounded plain object with expected schema_version and sections", async () => {
  const source = await routeSource();
  assert.match(source, /function isValidManagedVault\(/);
  assert.match(source, /function isPlainRecord\(/);
  assert.match(source, /value\["schema_version"\]\s*!==\s*EXPECTED_VAULT_SCHEMA_VERSION/);
  assert.match(source, /EXPECTED_MANAGED_VAULT_SECTIONS\s*=\s*\[/);
  assert.match(source, /Object\.keys\(sections\)\.length\s*!==\s*EXPECTED_MANAGED_VAULT_SECTIONS\.length/);
  assert.match(source, /Number\.isSafeInteger\(section\["count"\]\)/);
  assert.match(source, /section\["items"\]\.length\s*!==\s*section\["count"\]/);
  assert.match(source, /section\["items"\]\.every\(isPlainRecord\)/);
  assert.match(source, /MAX_MANAGED_VAULT_BYTES\s*=\s*1\s*\*\s*1024\s*\*\s*1024/);
});

test("malformed, oversized, missing, or RPC-error results fail closed with the route's safe error contract", async () => {
  const source = await routeSource();
  // RPC error OR invalid/missing managed vault both map to the safe 503 error,
  // so a partial export that silently omits the managed vault is impossible.
  assert.match(source, /managedVaultResult\.error/);
  assert.match(source, /isValidManagedVault\(managedVaultResult\.data\)/);
  assert.match(source, /return exportError\(503, "Account export data could not be read\."\)/);
  // Oversize responses are rejected after serialization (bounded response size).
  assert.match(source, /MAX_EXPORT_BYTES/);
  assert.match(source, /byteLength\s*>\s*MAX_EXPORT_BYTES/);
});

test("export route never exposes internal or private error detail", async () => {
  const source = await routeSource();
  // All downstream failures funnel through the opaque exportError() envelope.
  assert.match(source, /function exportError\(/);
  assert.match(source, /code:\s*"ACCOUNT_EXPORT_UNAVAILABLE"/);
  assert.doesNotMatch(source, /managedVaultResult\.error[\s\S]*\.message/);
  assert.doesNotMatch(source, /rpc\.error/);
  assert.doesNotMatch(source, /error\.message/);
  assert.doesNotMatch(source, /error\.details/);
  // The export surface only relays already-serialized SQL results; it never
  // pulls blob/storage objects or materializes signed content references.
  assert.doesNotMatch(source, /storage|signedUrl|createSignedUrl|blob\b/i);
});

test("export response is deterministic JSON with bounded byte size enclosure", async () => {
  const source = await routeSource();
  assert.match(source, /JSON\.stringify\(\{[\s\S]*kind: "skillmap\.account-export"[\s\S]*schemaVersion: 1[\s\S]*\}, null, 2\)/);
  assert.match(source, /MAX_EXPORT_BYTES/);
});
