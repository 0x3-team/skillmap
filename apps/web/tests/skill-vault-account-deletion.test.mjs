import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const ACTION = new URL("../app/account/data-actions.ts", import.meta.url);

async function actionSource() {
  return readFile(ACTION, "utf8");
}

test("deletion requires the exact confirmation before resolving auth context", async () => {
  const source = await actionSource();
  const confirmation = source.indexOf("hasExactAccountDeletionConfirmation(formData)");
  const context = source.indexOf("await deletionActionContext()");
  assert.ok(confirmation >= 0 && context > confirmation);
  assert.match(source, /delete-confirmation#account-data/);
});

test("deletion uses verified claims and fails closed for unavailable or signed-out auth", async () => {
  const source = await actionSource();
  assert.match(source, /supabase\.auth\.getClaims\(\)/);
  assert.match(source, /classifyVerifiedClaims\(data, error\)/);
  assert.match(source, /context\.state === "signed-out"/);
  assert.match(source, /context\.state === "unavailable"/);
});

test("self-deletion RPC accepts no caller-supplied target", async () => {
  const source = await actionSource();
  assert.match(source, /\.rpc\("delete_my_account"\)/);
  assert.doesNotMatch(source, /\.rpc\("delete_my_account"\s*,/);
  assert.doesNotMatch(source, /service[_-]?role|accountId|account_id/);
});

test("the browser session is removed locally after the deletion RPC", async () => {
  const source = await actionSource();
  const rpc = source.indexOf('.rpc("delete_my_account")');
  const signOut = source.indexOf('auth.signOut({ scope: "local" })');
  assert.ok(rpc >= 0 && signOut > rpc);
});

test("only an exact true RPC result receives a success flash", async () => {
  const source = await actionSource();
  assert.match(source, /if \(error \|\| data !== true\) redirect\("\/sign-in\?status=account-delete-unconfirmed"\)/);
  assert.match(source, /createAccountDeletionFlash\(token\)/);
});

test("the deletion flash cookie is short-lived and hardened", async () => {
  const source = await actionSource();
  assert.match(source, /httpOnly: true/);
  assert.match(source, /maxAge: 120/);
  assert.match(source, /sameSite: "strict"/);
  assert.match(source, /secure: accountDeletionFlashCookieSecure/);
  assert.match(source, /path: "\/sign-in"/);
});

test("the action does not claim that asynchronous blob cleanup is complete", async () => {
  const source = await actionSource();
  assert.doesNotMatch(source, /storage\.(?:from|remove)|deleteObject|blob(?:s)?\s+(?:deleted|complete)/i);
});
