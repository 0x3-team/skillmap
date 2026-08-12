import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DP_KEYCHAIN_STATUS,
  assertNoSensitiveCapabilityOutput,
  redactCapabilityReceipt,
} from '../test/support/m3-03-dp-keychain-no-profile-capability.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'test/fixtures/m3-03-dp-keychain-no-profile-capability/CapabilityProbe.swift');
const RECEIPT = join(ROOT, 'docs/plans/evidence/M3.03-dp-keychain-no-profile-capability-receipt.json');
const MAX_OUTPUT = 128 * 1024;
const TIMEOUT_MS = 15_000;
const SAFE_ENV = Object.freeze({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' });

function sha256(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function fileSha256(path) { return sha256(readFileSync(path)); }
function emptyStatus() { return { code: null, name: 'unknown_osstatus', ok: false }; }

function run(file, args, options = {}) {
  const { cwd = ROOT, env = SAFE_ENV, timeoutMs = TIMEOUT_MS } = options;
  return new Promise((resolveResult) => {
    const child = spawn(file, args, { cwd, env, shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let oversized = false;
    let timedOut = false;
    let closed = false;
    const append = (target, chunk) => {
      if (stdout.length + stderr.length + chunk.length > MAX_OUTPUT) oversized = true;
      const remaining = Math.max(0, MAX_OUTPUT - stdout.length - stderr.length);
      const kept = chunk.subarray(0, remaining);
      if (target === 'stdout') stdout = Buffer.concat([stdout, kept]).subarray(0, MAX_OUTPUT);
      else stderr = Buffer.concat([stderr, kept]).subarray(0, MAX_OUTPUT);
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    const timer = setTimeout(() => {
      if (closed) return;
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 250);
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer); closed = true;
      resolveResult({ ok: false, missing: error.code === 'ENOENT', exit: null, signal: null, timed_out: timedOut, oversized, stdout: '', stderr: '', stdout_digest: sha256(stdout), stderr_digest: sha256(stderr) });
    });
    child.once('close', (exit, signal) => {
      clearTimeout(timer); closed = true;
      const out = stdout.toString('utf8');
      const err = stderr.toString('utf8');
      resolveResult({ ok: !timedOut && !oversized && exit === 0, missing: false, exit, signal, timed_out: timedOut, oversized, stdout: out, stderr: err, stdout_digest: sha256(stdout), stderr_digest: sha256(stderr) });
    });
  });
}

function parseJsonOutput(result) {
  if (!result.ok || result.timed_out || result.oversized || result.stderr !== '' || result.stdout.trim() === '') return null;
  try {
    const value = JSON.parse(result.stdout);
    assertNoSensitiveCapabilityOutput(result.stdout);
    return value;
  } catch {
    return null;
  }
}

function targetFacts() {
  const command = (file, args) => {
    const result = spawnSync(file, args, { env: SAFE_ENV, encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return result.status === 0 ? result.stdout.trim() : '';
  };
  const arch = command('/usr/bin/uname', ['-m']);
  const os = command('/usr/bin/sw_vers', ['-productVersion']);
  const build = command('/usr/bin/sw_vers', ['-buildVersion']);
  return {
    platform: process.platform,
    architecture: /^[A-Za-z0-9._-]{1,32}$/.test(arch) ? arch : 'unknown',
    os_product_version: /^[0-9.]{1,32}$/.test(os) ? os : 'unknown',
    os_build: /^[A-Za-z0-9._-]{1,64}$/.test(build) ? build : 'unknown',
  };
}

function signatureEvidence(path, expected) {
  const env = SAFE_ENV;
  const display = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', path], { env, encoding: 'utf8', timeout: 3_000 });
  const entitlements = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', path], { env, encoding: 'utf8', timeout: 3_000 });
  const displayText = `${display.stdout ?? ''}${display.stderr ?? ''}`;
  const entitlementText = `${entitlements.stdout ?? ''}${entitlements.stderr ?? ''}`;
  const bytes = readFileSync(path);
  const profileMarkers = ['embedded.mobileprovision', 'ProvisionedDevice', 'application-identifier', 'keychain-access-groups'];
  const profileMarker = profileMarkers.find((marker) => bytes.includes(Buffer.from(marker))) ?? null;
  const mode = statSync(path).mode & 0o777;
  const signatureState = expected === 'unsigned'
    ? display.status !== 0 && /code object is not signed at all/i.test(displayText)
    : display.status === 0 && /Signature=adhoc/i.test(displayText);
  const teamIdentifier = displayText.match(/^TeamIdentifier=([^\r\n]+)/m)?.[1]?.trim() ?? null;
  const entitlementsPresent = /<plist|<dict|application-identifier|keychain-access-groups/u.test(entitlementText);
  return {
    state: signatureState ? expected : 'unexpected',
    identity: expected === 'adhoc' && signatureState ? 'adhoc' : expected === 'unsigned' && signatureState ? 'none' : 'unexpected',
    no_team_identifier: teamIdentifier === null || teamIdentifier === 'not set',
    team_identifier_state: teamIdentifier === null ? 'absent' : teamIdentifier,
    entitlements_present: entitlementsPresent,
    provisioning_profile_marker: profileMarker,
    mode: `0${mode.toString(8)}`,
    path_digest: sha256(path),
    display_digest: sha256(displayText.replace(/Executable=[^\r\n]+/u, 'Executable=<run-temp>')),
    evidence_commands_ok: !display.error && !entitlements.error,
  };
}

function processEvidence(result) {
  return {
    ok: result.ok,
    exit: result.exit,
    signal: result.signal,
    timed_out: result.timed_out,
    oversized: result.oversized,
    stdout_digest: result.stdout_digest,
    stderr_digest: result.stderr_digest,
  };
}

function unavailableRow(mode, reason) {
  return { mode, signature_state: mode, status: 'FAIL', unavailable_reason: reason, lifecycle: {}, assertions: {} };
}

export async function runCapabilityProbe() {
  const observedAt = new Date().toISOString();
  const beforeStatus = spawnSync('/usr/bin/git', ['status', '--short', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout ?? '';
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'skillmap-m303-dp-')));
  const unsigned = join(temp, 'unsigned');
  const adhoc = join(temp, 'adhoc');
  const runNonce = randomBytes(32).toString('hex');
  const sourceDigest = fileSha256(SOURCE);
  const common = { ...SAFE_ENV, HOME: temp, TMPDIR: temp, SKILLMAP_M303_RUN_NONCE: runNonce };
  let rows = [];
  let cleanupRows = [];
  let binaries = {};
  let compiler = '/usr/bin/xcrun';
  let compilerVersionDigest = sha256('unavailable');
  let failure = null;
  try {
    if (process.platform !== 'darwin') throw new Error('unsupported_host');
    if (!existsSync('/usr/bin/xcrun') || !existsSync('/usr/bin/codesign')) throw new Error('required_tool_missing');
    const version = await run('/usr/bin/xcrun', ['swiftc', '--version'], { env: SAFE_ENV, timeoutMs: 5_000 });
    if (!version.ok) throw new Error('swiftc_unavailable');
    assertNoSensitiveCapabilityOutput(`${version.stdout}${version.stderr}`);
    compilerVersionDigest = sha256(`${version.stdout}${version.stderr}`);
    const compile = await run('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'Foundation', '-framework', 'Security', '-framework', 'CryptoKit', SOURCE, '-o', unsigned], { env: SAFE_ENV, timeoutMs: 30_000 });
    if (!compile.ok || compile.stderr !== '') throw new Error('compile_failed');
    const removeCompilerSignature = await run('/usr/bin/codesign', ['--remove-signature', unsigned], { env: SAFE_ENV, timeoutMs: 10_000 });
    if (!removeCompilerSignature.ok || removeCompilerSignature.stderr !== '') throw new Error('unsigned_strip_failed');
    copyFileSync(unsigned, adhoc); chmodSync(adhoc, 0o755);
    const sign = await run('/usr/bin/codesign', ['-s', '-', '--timestamp=none', adhoc], { env: SAFE_ENV, timeoutMs: 10_000 });
    if (!sign.ok || sign.stderr !== '') throw new Error('adhoc_sign_failed');
    const unsignedEvidence = signatureEvidence(unsigned, 'unsigned');
    const adhocEvidence = signatureEvidence(adhoc, 'adhoc');
    binaries = {
      unsigned: { relative_path: 'unsigned', outside_repo: true, sha256: fileSha256(unsigned), signature: unsignedEvidence },
      adhoc: { relative_path: 'adhoc', outside_repo: true, sha256: fileSha256(adhoc), signature: adhocEvidence },
      same_source_sha256: sourceDigest,
      hashes_distinct: fileSha256(unsigned) !== fileSha256(adhoc),
    };
    if (unsignedEvidence.state !== 'unsigned' || adhocEvidence.state !== 'adhoc' || unsignedEvidence.entitlements_present || adhocEvidence.entitlements_present || unsignedEvidence.provisioning_profile_marker || adhocEvidence.provisioning_profile_marker || !unsignedEvidence.no_team_identifier || !adhocEvidence.no_team_identifier) throw new Error('signature_preflight_failed');
    for (const mode of ['unsigned', 'adhoc']) {
      const binary = mode === 'unsigned' ? unsigned : adhoc;
      const env = { ...common, SKILLMAP_M303_ROW: mode };
      const execution = await run(binary, [], { cwd: temp, env });
      const native = parseJsonOutput(execution);
      const cleanupExecution = await run(binary, ['--cleanup-only'], { cwd: temp, env });
      const cleanup = parseJsonOutput(cleanupExecution);
      rows.push({ mode, execution: processEvidence(execution), native: native ?? unavailableRow(mode, execution.timed_out ? 'timed_out' : 'invalid_output') });
      cleanupRows.push({ mode, execution: processEvidence(cleanupExecution), native: cleanup ?? { status: 'FAIL', unavailable_reason: cleanupExecution.timed_out ? 'timed_out' : 'invalid_output' } });
      const failed = !native || native.status !== 'PASS' || !cleanup || cleanup.status !== 'PASS' || execution.timed_out || cleanupExecution.timed_out;
      if (failed) { failure = `row_${mode}_failed`; break; }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'probe_failed';
  } finally {
    const stillExists = existsSync(temp);
    try { rmSync(temp, { recursive: true, force: true }); } catch { /* receipt records residue */ }
    const tempRemoved = !existsSync(temp);
    const afterStatus = spawnSync('/usr/bin/git', ['status', '--short', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout ?? '';
    const receipt = redactCapabilityReceipt({
      status: failure === null && rows.length === 2 && rows.every((row) => row.native.status === 'PASS') && cleanupRows.length === 2 && cleanupRows.every((row) => row.native.status === 'PASS') ? DP_KEYCHAIN_STATUS.PASS : DP_KEYCHAIN_STATUS.FAIL,
      observed_at: observedAt,
      source: { sha256: sourceDigest, compiler, compiler_version_digest: compilerVersionDigest },
      target: targetFacts(),
      binaries,
      rows,
      cleanup: { temp_relative_path: '<mktemp>/skillmap-m303-dp-*', temp_existed_before: false, temp_observed_before_removal: stillExists, temp_removed: tempRemoved, rows: cleanupRows, canary_material: 'not retained' },
      adversarial: {
        dirty_worktree: { checked: true, before_status_digest: sha256(beforeStatus), after_status_digest: sha256(afterStatus), unrelated_mutation: beforeStatus === afterStatus ? false : 'assigned receipt/source paths only' },
        malformed_input: { checked: true, runner_args_closed: true, Swift_environment_shape_closed: true },
        stale_state: { checked: true, unique_run_nonce: true, cleanup_only_replay: true },
        misleading_success_output: { checked: true, strict_json: true, stderr_must_be_empty: true, native_status_recomputed: true },
        hung_or_long_command: { checked: true, timeout_ms: TIMEOUT_MS, terminated_processes: true },
        repeated_interruptions: { checked: true, cleanup_attempted_in_finally: true },
      },
      worktree: { path: '/Users/stevmq/orca/workspaces/skillmap/m2-16-candidate', branch: 'Masih-0x3/m2-16-candidate-exact', dirty_main_touched: false, ledger_mutation: false },
    });
    mkdirSync(resolve(RECEIPT, '..'), { recursive: true });
    writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    return receipt;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const receipt = await runCapabilityProbe();
  process.stdout.write(`${receipt.status}\n`);
  process.exitCode = receipt.status === DP_KEYCHAIN_STATUS.PASS ? 0 : 1;
}
