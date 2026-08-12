import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, constants as FS_CONSTANTS, existsSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APPLE_READINESS_STATUS,
  evaluateAppleSigningReadinessV1,
  parseFindIdentityV1,
  parseNativeFindIdentityV1,
  parseNativePublicCertificatesV1,
  parseNativeProfileJsonV1,
  parsePublicCertificatesV1,
  parseProvisioningProfileV1,
  redactAppleSigningReadinessReceiptV1,
} from '../test/support/m3-03-apple-signing-readiness.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const MAX_OUTPUT = 256 * 1024;
const OBSERVED_AT = '2026-08-10T12:00:00.000Z';
// Node exposes O_NOFOLLOW on Darwin but omits O_CLOEXEC from fs.constants;
// Darwin's stable open(2) value is used only on Darwin, and every other
// runtime fails closed before any inventory command can run.
const O_CLOEXEC = FS_CONSTANTS.O_CLOEXEC ?? (process.platform === 'darwin' ? 0x1000000 : undefined);
const ENV = Object.freeze({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LANG: 'C',
  LC_ALL: 'C',
});
const SAFE_COMMANDS = Object.freeze([
  ['/usr/bin/sw_vers', ['-productVersion'], 'os_product', 0],
  ['/usr/bin/sw_vers', ['-buildVersion'], 'os_build', 0],
  ['/usr/bin/uname', ['-m'], 'arch', 0],
  ['/usr/bin/id', ['-u'], 'uid', 0],
  ['/usr/bin/id', ['-un'], 'user', 0],
  ['/usr/bin/id', ['-Gn'], 'groups', 0],
  ['/usr/bin/stat', ['-f', '%Su', '/dev/console'], 'console_user', 0],
  ['/usr/sbin/scutil', ['--nwi'], 'network', 0],
  ['/usr/sbin/netstat', ['-rn', '-f', 'inet'], 'route_ipv4', 0],
  ['/usr/sbin/netstat', ['-rn', '-f', 'inet6'], 'route_ipv6', 0],
  ['/usr/bin/xcode-select', ['-p'], 'xcode_select', 0],
  ['/usr/sbin/pkgutil', ['--pkg-info', 'com.apple.pkg.CLTools_Executables'], 'clt', 0],
  ['/usr/bin/xcrun', ['--find', 'swiftc'], 'swiftc', 0],
  ['/usr/bin/xcrun', ['swiftc', '--version'], 'swiftc_version', 0],
  ['/usr/bin/xcrun', ['--find', 'codesign'], 'codesign', 0],
  ['/usr/bin/xcrun', ['--find', 'notarytool'], 'notarytool', 0],
  ['/usr/bin/xcrun', ['notarytool', '--version'], 'notarytool_version', 0],
  ['/usr/bin/xcrun', ['--find', 'stapler'], 'stapler', 0],
  ['/usr/bin/xcrun', ['--find', 'security'], 'security', 0],
  ['/usr/bin/codesign', ['-h'], 'codesign_help', 2],
  ['/usr/bin/security', ['help', 'find-identity'], 'security_help_identity', 0],
  ['/usr/bin/security', ['help', 'cms'], 'security_help_cms', 0],
  ['/usr/bin/xcrun', ['stapler'], 'stapler_help', 64],
  ['/usr/bin/plutil', ['-help'], 'plutil_help', 0],
]);
const GUARDED_TOKENS = Object.freeze(['default-keychain', 'find-identity', 'find-certificate', 'cms', 'plutil', 'unlock-keychain', 'security import', 'security export']);
const ALLOWED_TOOL_ROOTS = Object.freeze(['/usr/bin/', '/usr/sbin/', '/sbin/', '/Library/Developer/CommandLineTools/', '/Applications/Xcode.app/Contents/Developer/']);
const TOOL_LABELS = Object.freeze(['swiftc', 'codesign', 'security', 'notarytool', 'stapler', 'plutil']);

export { SAFE_COMMANDS, readRequest };

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function internalFailure() { throw new Error('internal readiness invariant'); }
function parseArgs(argv) {
  const out = { mode: null, taskRoot: null, fixtureCase: 'all-ready', output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') out.mode = argv[++index];
    else if (arg === '--task-root') out.taskRoot = argv[++index];
    else if (arg === '--fixture-case') out.fixtureCase = argv[++index];
    else if (arg === '--output') out.output = argv[++index];
    else internalFailure();
  }
  if (!['tool-only', 'inventory', 'fixture'].includes(out.mode) || out.output !== '-') internalFailure();
  if (out.mode !== 'inventory' && out.taskRoot) internalFailure();
  if (out.mode === 'inventory' && (!out.taskRoot || !isAbsolute(out.taskRoot) || normalize(out.taskRoot) !== out.taskRoot)) internalFailure();
  return out;
}

function decodeUtf8(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return null; }
}

function parseStrictJson(source) {
  let offset = 0;
  const bad = () => internalFailure();
  const whitespace = () => { while (offset < source.length && ' \t\r\n'.includes(source[offset])) offset += 1; };
  const string = () => {
    if (source[offset] !== '"') bad();
    const start = offset++;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x22) { offset += 1; try { return JSON.parse(source.slice(start, offset)); } catch { bad(); } }
      if (code < 0x20) bad();
      if (code === 0x5c) {
        offset += 1;
        if (offset >= source.length) bad();
        if (source[offset] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(offset + 1, offset + 5))) bad();
          offset += 5;
        } else if ('"\\/bfnrt'.includes(source[offset])) offset += 1;
        else bad();
      } else offset += 1;
    }
    bad();
  };
  const value = () => {
    whitespace();
    if (source[offset] === '"') return string();
    if (source[offset] === '{') return object();
    if (source[offset] === '[') return array();
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) if (source.startsWith(token, offset)) { offset += token.length; return result; }
    const match = source.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) bad();
    offset += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) bad();
    return number;
  };
  const object = () => {
    offset += 1; whitespace(); const output = {}; const keys = new Set();
    if (source[offset] === '}') { offset += 1; return output; }
    while (offset < source.length) {
      const key = string();
      if (keys.has(key)) bad();
      keys.add(key); whitespace(); if (source[offset++] !== ':') bad(); output[key] = value(); whitespace();
      if (source[offset] === '}') { offset += 1; return output; }
      if (source[offset++] !== ',') bad(); whitespace();
    }
    bad();
  };
  const array = () => {
    offset += 1; whitespace(); const output = [];
    if (source[offset] === ']') { offset += 1; return output; }
    while (offset < source.length) {
      output.push(value()); whitespace();
      if (source[offset] === ']') { offset += 1; return output; }
      if (source[offset++] !== ',') bad(); whitespace();
    }
    bad();
  };
  whitespace(); const result = value(); whitespace(); if (offset !== source.length) bad();
  return result;
}

function parseGuardedJson(result) {
  if (!result || result.oversized || result.timed_out || result.invalid_utf8 || !result.ok || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout, 'utf8') > MAX_OUTPUT) internalFailure();
  return parseStrictJson(result.stdout);
}

function pathClass(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || path.includes('\n') || path.includes('\r') || !ALLOWED_TOOL_ROOTS.some((prefix) => path.startsWith(prefix))) internalFailure();
  if (path.startsWith('/Applications/Xcode.app/')) return 'xcode';
  if (path.startsWith('/Library/Developer/CommandLineTools/')) return 'clt';
  return 'system';
}

function validateExecutablePath(path, label, synthetic = false) {
  if (typeof path !== 'string' || !isAbsolute(path) || !path.endsWith(`/${label}`)) internalFailure();
  const lexicalClass = pathClass(path);
  if (synthetic) return lexicalClass;
  const canonical = realpathSync(noSymlinkPath(path));
  if (canonical !== path || !canonical.endsWith(`/${label}`)) internalFailure();
  const parts = canonical.split('/').filter(Boolean);
  let current = '/';
  for (const part of parts) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) internalFailure();
    if (current === canonical && (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o111) === 0)) internalFailure();
  }
  const first = lstatSync(canonical); const second = lstatSync(canonical);
  if (first.dev !== second.dev || first.ino !== second.ino || first.mode !== second.mode || first.uid !== second.uid) internalFailure();
  return pathClass(canonical);
}

function runCommand(file, args, taskRoot, expectedExit = 0, input = undefined, inheritedKeychainFd = undefined) {
  return new Promise((resolveResult) => {
    const env = { ...ENV, HOME: taskRoot, TMPDIR: taskRoot, USER: 'disposable', LOGNAME: 'disposable' };
    const child = spawn(file, args, { cwd: taskRoot, env, shell: false, detached: false, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe', inheritedKeychainFd === undefined ? 'ignore' : inheritedKeychainFd] });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let oversized = false;
    let timedOut = false;
    let closed = false;
    const append = (name, chunk) => {
      if (stdout.byteLength + stderr.byteLength + chunk.byteLength > MAX_OUTPUT) oversized = true;
      const target = name === 'stdout' ? stdout : stderr;
      const remaining = Math.max(0, MAX_OUTPUT - stdout.byteLength - stderr.byteLength);
      const kept = Buffer.concat([target, chunk.subarray(0, remaining)]);
      if (name === 'stdout') stdout = kept.subarray(0, MAX_OUTPUT);
      else stderr = kept.subarray(0, MAX_OUTPUT);
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      closed = true;
      resolveResult({ ok: false, missing: error?.code === 'ENOENT', exit: null, timed_out: timedOut, oversized, invalid_utf8: false, stdout: '', stderr: '', stdout_digest: hash(stdout), stderr_digest: hash(stderr) });
    });
    child.once('close', (exit, signal) => {
      clearTimeout(timer);
      closed = true;
      const stdoutText = decodeUtf8(stdout);
      const stderrText = decodeUtf8(stderr);
      resolveResult({ ok: !timedOut && !oversized && stdoutText !== null && stderrText !== null && exit === expectedExit, missing: false, exit, signal, timed_out: timedOut, oversized, invalid_utf8: stdoutText === null || stderrText === null, stdout: stdoutText ?? '', stderr: stderrText ?? '', stdout_digest: hash(stdout), stderr_digest: hash(stderr) });
    });
    const timer = setTimeout(() => {
      if (closed) return;
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 150);
    }, 5000);
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function collectToolOnly(taskRoot, commandRunner = runCommand) {
  const results = new Map();
  const trace = [];
  for (const [file, args, label, expectedExit] of SAFE_COMMANDS) {
    if (GUARDED_TOKENS.some((token) => args.join(' ').includes(token) && token !== 'find-identity' && token !== 'cms')) internalFailure();
    const result = await commandRunner(file, args, taskRoot, expectedExit);
    results.set(label, result);
    // The trace is retained only as a digest. Raw command output/arguments are
    // never included in the receipt or stderr.
    trace.push({ label, exit: result.exit, timed_out: result.timed_out, oversized: result.oversized });
  }
  const ok = (label) => results.get(label)?.ok === true;
  const archRaw = results.get('arch')?.stdout.trim() ?? '';
  const archText = ['arm64', 'x86_64'].includes(archRaw) ? archRaw : 'unknown';
  const groups = results.get('groups')?.stdout.split(/\s+/u).filter(Boolean) ?? [];
  const userRaw = results.get('user')?.stdout.trim() ?? '';
  const uidRaw = results.get('uid')?.stdout.trim() ?? '';
  const consoleRaw = results.get('console_user')?.stdout.trim() ?? '';
  const network = results.get('network');
  const route4 = results.get('route_ipv4');
  const route6 = results.get('route_ipv6');
  const anyBad = [...results.values()].some((item) => item.timed_out || item.oversized || item.invalid_utf8);
  let pathFailure = false;
  for (const label of TOOL_LABELS.filter((item) => item !== 'plutil')) {
    const result = results.get(label);
    if (result?.ok) {
      try {
        const resolved = result.stdout.trim();
        if (!resolved.endsWith(`/${label}`)) throw new Error('unexpected tool');
        validateExecutablePath(resolved, label, commandRunner !== runCommand);
      } catch { pathFailure = true; }
    }
  }
  const normalizedUser = /^[A-Za-z0-9._-]{1,80}$/.test(userRaw) ? userRaw : '';
  const normalizedConsole = /^[A-Za-z0-9._-]{1,80}$/.test(consoleRaw) ? consoleRaw : '';
  const normalizedUid = /^[0-9]{1,10}$/.test(uidRaw) ? uidRaw : '';
  const groupsMalformed = groups.some((group) => !/^[A-Za-z0-9._-]{1,80}$/.test(group));
  const parseRoute = (result) => {
    if (!result?.ok || result.stderr !== '' || result.stdout.length > MAX_OUTPUT) return { ok: false, external: false };
    const text = result.stdout;
    if (!/^(?:[\t ]*Destination[\t ]+Gateway[\t ]+Flags[\s\S]*|[\t ]*Routing tables[\s\S]*)$/m.test(text)) return { ok: false, external: false };
    const external = /(?:^|\n)[^\n]*(?:default|0\.0\.0\.0|::\/0|[12]?\d?\d\.[12]?\d?\d\.[12]?\d?\d\.[12]?\d?\d|[2-9a-fA-F][0-9a-fA-F:]*\/\d+)[^\n]*/.test(text.replace(/127\.0\.0\.1|::1/g, ''));
    return { ok: true, external };
  };
  const parsed4 = parseRoute(route4);
  const parsed6 = parseRoute(route6);
  const networkResult = results.get('network');
  const networkEvidence = Boolean(networkResult?.ok && networkResult.stderr === '' && networkResult.stdout.trim().length > 0);
  const normalizationFailure = (archRaw !== '' && archText === 'unknown') || (userRaw !== '' && !normalizedUser) || (consoleRaw !== '' && !normalizedConsole) || (uidRaw !== '' && !normalizedUid) || groupsMalformed || pathFailure;
  const pathClasses = {};
  const toolDigests = {};
  const toolHelpDigests = {};
  let fingerprintsComplete = true;
  const resolvedTools = {
    swiftc: results.get('swiftc')?.stdout.trim(),
    codesign: results.get('codesign')?.stdout.trim(),
    security: results.get('security')?.stdout.trim(),
    notarytool: results.get('notarytool')?.stdout.trim(),
    stapler: results.get('stapler')?.stdout.trim(),
    plutil: '/usr/bin/plutil',
  };
  for (const label of TOOL_LABELS) {
    try {
      if (!resolvedTools[label] || (commandRunner === runCommand && !existsSync(resolvedTools[label]))) throw new Error('missing');
      if (!resolvedTools[label].endsWith(`/${label}`)) throw new Error('unexpected tool');
      pathClasses[label] = validateExecutablePath(resolvedTools[label], label, commandRunner !== runCommand);
      toolDigests[label] = commandRunner === runCommand ? hash(readFileSync(resolvedTools[label])) : hash(`synthetic-tool:${label}:${resolvedTools[label]}`);
    } catch { fingerprintsComplete = false; }
  }
  for (const label of ['codesign', 'security_find_identity', 'security_cms', 'stapler', 'plutil']) {
    const helpLabels = label === 'codesign' ? ['codesign_help'] : label === 'security_find_identity' ? ['security_help_identity'] : label === 'security_cms' ? ['security_help_cms'] : label === 'stapler' ? ['stapler_help'] : ['plutil_help'];
    const helpResults = helpLabels.map((item) => results.get(item));
    if (helpResults.some((item) => !item || item.invalid_utf8 || item.oversized || item.timed_out)) fingerprintsComplete = false;
    else toolHelpDigests[label] = hash(helpResults.map((item) => `${item.stdout.replace(/\s+/gu, ' ').trim()}\n${item.stderr.replace(/\s+/gu, ' ').trim()}`).join('\n'));
  }
  return {
    schema: 'skillmap.m3-03.apple-signing-readiness.tool.v1',
    arch: archText,
    // Tool-only has no mode-0600 request file and therefore has genuine
    // observed evidence only for host/group state, never disposable custody.
    runner: { disposable: false, current_matches: false, non_admin: !groups.includes('admin'), private_home: false, private_task: false, shared_account: true },
    network: { evidence: networkEvidence, offline: Boolean(networkEvidence && parsed4.ok && parsed6.ok && !parsed4.external && !parsed6.external), scutil_ok: Boolean(networkResult?.ok && networkResult.stderr === ''), ipv4_ok: parsed4.ok, ipv6_ok: parsed6.ok, route_parsed: parsed4.ok && parsed6.ok, ipv4_external: parsed4.external, ipv6_external: parsed6.external, unverified: !networkEvidence || !parsed4.ok || !parsed6.ok },
    clt: { present: ok('clt'), xcode_select: ok('xcode_select') },
    tools: { swiftc: ok('swiftc') && ok('swiftc_version'), codesign: ok('codesign') && ok('codesign_help'), security: ok('security') && ok('security_help_identity') && ok('security_help_cms'), notarytool: ok('notarytool') && ok('notarytool_version'), stapler: ok('stapler') && ok('stapler_help'), plutil: existsSync('/usr/bin/plutil') },
    command_output_valid: !anyBad,
    command_output_oversized: [...results.values()].some((item) => item.oversized),
    command_output_invalid_utf8: [...results.values()].some((item) => item.invalid_utf8),
    timed_out: [...results.values()].some((item) => item.timed_out),
    inventory_failure: normalizationFailure || [...results.entries()].some(([label, item]) => !['network', 'route_ipv4', 'route_ipv6'].includes(label) && !item.missing && !item.ok && ![2, 64].includes(item.exit)),
    trace_digest: hash(JSON.stringify(trace)),
    tool_path_classes: fingerprintsComplete ? pathClasses : {},
    tool_digests: fingerprintsComplete ? toolDigests : {},
    tool_help_digests: fingerprintsComplete ? toolHelpDigests : {},
    fingerprint_complete: fingerprintsComplete,
    help_fingerprint_complete: fingerprintsComplete,
    _observed: { uid: normalizedUid, user: normalizedUser, console_user: normalizedConsole, groups: groups.map((group) => /^[A-Za-z0-9._-]{1,80}$/.test(group) ? group : '') },
  };
}

function clone(value) { return structuredClone(value); }
function setPath(value, path, next) {
  const parts = path.split('.');
  let target = value;
  for (const part of parts.slice(0, -1)) target = target[part];
  target[parts.at(-1)] = clone(next);
}
function fixtureInput(caseId) {
  const bundle = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/m3-03-apple-signing-readiness/cases.json'), 'utf8'));
  const selected = bundle.cases.find((entry) => entry.id === caseId);
  if (!selected) internalFailure();
  const input = clone(bundle.base);
  for (const mutation of selected.mutations ?? []) setPath(input, mutation.path, mutation.value);
  return { input, now: new Date(bundle.fixed_now) };
}

function assertClosedData(value) {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) if (!Object.prototype.hasOwnProperty.call(value, index)) internalFailure();
    for (const key of Reflect.ownKeys(value)) if (key !== 'length' && !/^\d+$/.test(String(key))) internalFailure();
    for (const item of value) assertClosedData(item);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) internalFailure();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') internalFailure();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) internalFailure();
    assertClosedData(value[key]);
  }
}

const REQUEST_SCHEMA = 'skillmap.m3-03.apple-signing-readiness-request.v1';
const REQUEST_RELATIVE = Object.freeze({ keychain: 'signing.keychain-db', launcher: 'profiles/launcher.provisionprofile', helper: 'profiles/helper.provisionprofile' });

function noSymlinkPath(path) {
  const absolute = resolve(path);
  const parts = absolute.split('/').filter(Boolean);
  let current = '/';
  for (const part of parts) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) internalFailure();
  }
  return absolute;
}

function guardedStat(path, mode, owner, device) {
  const lexical = noSymlinkPath(path);
  const stat = lstatSync(lexical);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== owner || (stat.mode & 0o777) !== mode || stat.nlink !== 1 || (device !== undefined && stat.dev !== device)) internalFailure();
  const canonical = realpathSync(lexical);
  const after = lstatSync(lexical);
  if (after.dev !== stat.dev || after.ino !== stat.ino || after.nlink !== stat.nlink || after.mode !== stat.mode || after.uid !== stat.uid) internalFailure();
  return { path: lexical, canonical, stat };
}

function openStableDescriptor(path, expected, cap) {
  if (FS_CONSTANTS.O_RDONLY === undefined || FS_CONSTANTS.O_NOFOLLOW === undefined || O_CLOEXEC === undefined) internalFailure();
  const fd = openSync(path, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW | O_CLOEXEC);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.dev !== expected.stat.dev || stat.ino !== expected.stat.ino || stat.uid !== expected.stat.uid || stat.gid !== expected.stat.gid || stat.nlink !== expected.stat.nlink || stat.mode !== expected.stat.mode || stat.size !== expected.stat.size || stat.size > cap) internalFailure();
    const descriptor = { fd, stat, content_digest: null };
    descriptor.content_digest = descriptorContentDigest(descriptor, cap);
    return descriptor;
  } catch (error) { closeSync(fd); throw error; }
}

function descriptorContentDigest(descriptor, cap) {
  const before = fstatSync(descriptor.fd);
  if (before.size > cap || before.size !== descriptor.stat.size || before.ino !== descriptor.stat.ino || before.dev !== descriptor.stat.dev) internalFailure();
  const digest = createHash('sha256');
  const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, before.size)));
  let position = 0;
  while (position < before.size) {
    const wanted = Math.min(chunk.byteLength, before.size - position);
    const count = readSync(descriptor.fd, chunk, 0, wanted, position);
    if (count !== wanted) internalFailure();
    digest.update(chunk.subarray(0, count));
    chunk.fill(0);
    position += count;
  }
  const after = fstatSync(descriptor.fd);
  if (after.size !== before.size || after.ino !== before.ino || after.dev !== before.dev || after.uid !== before.uid || after.gid !== before.gid || after.nlink !== before.nlink || after.mode !== before.mode) internalFailure();
  return digest.digest('hex');
}

function readDescriptor(descriptor, cap) {
  const before = fstatSync(descriptor.fd);
  if (before.mode !== descriptor.stat.mode || before.uid !== descriptor.stat.uid || before.gid !== descriptor.stat.gid || before.nlink !== descriptor.stat.nlink || before.ino !== descriptor.stat.ino || before.dev !== descriptor.stat.dev || before.size !== descriptor.stat.size || before.size > cap) internalFailure();
  const value = readFileSync(descriptor.fd);
  const after = fstatSync(descriptor.fd);
  if (after.mode !== before.mode || after.uid !== before.uid || after.gid !== before.gid || after.nlink !== before.nlink || after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size) internalFailure();
  if (descriptor.content_digest !== null && descriptorContentDigest(descriptor, cap) !== descriptor.content_digest) internalFailure();
  return value;
}

function readRequest(taskRoot, strictRoot = false, keepDescriptors = false) {
  if (typeof taskRoot !== 'string' || !isAbsolute(taskRoot) || normalize(taskRoot) !== taskRoot) internalFailure();
  if (strictRoot) {
    const runId = relative(resolve(homedir()), resolve(taskRoot));
    if (!/^\.skillmap-m3-apple-readiness\/[a-z0-9][a-z0-9-]{0,47}$/.test(runId)) internalFailure();
  }
  const root = noSymlinkPath(taskRoot);
  const rootStat = lstatSync(root);
  const owner = process.getuid();
  if (!rootStat.isDirectory() || rootStat.uid !== owner || (rootStat.mode & 0o777) !== 0o700 || rootStat.nlink < 1) internalFailure();
  const profilesDir = join(root, 'profiles');
  const alternatesDir = join(profilesDir, 'alternates');
  for (const directory of [profilesDir, alternatesDir]) {
    const stat = lstatSync(noSymlinkPath(directory));
    if (!stat.isDirectory() || stat.uid !== owner || (stat.mode & 0o777) !== 0o700 || stat.nlink < 1) internalFailure();
  }
  const requestMeta = guardedStat(join(root, 'request.json'), 0o600, owner, rootStat.dev);
  const requestDescriptor = openStableDescriptor(requestMeta.path, requestMeta, 16 * 1024);
  const raw = readDescriptor(requestDescriptor, 16 * 1024);
  if (raw.byteLength > 16 * 1024) internalFailure();
  const decoded = decodeUtf8(raw);
  if (decoded === null) internalFailure();
  const request = parseStrictJson(decoded);
  assertClosedData(request);
  const required = ['schema', 'expected_team_id', 'disposable_user', 'disposable_uid', 'dedicated_keychain_relpath', 'launcher_profile_relpath', 'helper_profile_relpath', 'alternate_profile_relpaths'];
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some((key) => !required.includes(key)) || required.some((key) => !Object.prototype.hasOwnProperty.call(request, key))) internalFailure();
  if (request.schema !== REQUEST_SCHEMA || !/^[A-Z0-9]{10}$/.test(request.expected_team_id) || !/^[a-z][a-z0-9-]{0,47}$/.test(request.disposable_user) || !Number.isSafeInteger(request.disposable_uid) || request.disposable_uid < 1 || typeof request.dedicated_keychain_relpath !== 'string' || typeof request.launcher_profile_relpath !== 'string' || typeof request.helper_profile_relpath !== 'string' || !Array.isArray(request.alternate_profile_relpaths) || request.alternate_profile_relpaths.length > 8) internalFailure();
  if (request.disposable_uid !== process.getuid()) internalFailure();
  if (request.dedicated_keychain_relpath !== REQUEST_RELATIVE.keychain || request.launcher_profile_relpath !== REQUEST_RELATIVE.launcher || request.helper_profile_relpath !== REQUEST_RELATIVE.helper || request.alternate_profile_relpaths.some((item) => typeof item !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}\.provisionprofile$/.test(item))) internalFailure();
  const paths = [
    [request.dedicated_keychain_relpath, join(root, request.dedicated_keychain_relpath), 64 * 1024 * 1024],
    [request.launcher_profile_relpath, join(root, request.launcher_profile_relpath), 1024 * 1024],
    [request.helper_profile_relpath, join(root, request.helper_profile_relpath), 1024 * 1024],
    ...request.alternate_profile_relpaths.map((name) => [`profiles/alternates/${name}`, join(alternatesDir, name), 1024 * 1024]),
  ];
  const seen = new Set();
  const targets = {};
  for (const [relative, path, cap] of paths) {
    if (seen.has(relative)) internalFailure();
    seen.add(relative);
    const meta = guardedStat(path, 0o600, owner, rootStat.dev);
    if (meta.stat.size === 0 && relative === REQUEST_RELATIVE.keychain) internalFailure();
    if (meta.stat.size > cap) internalFailure();
    const relativeCanonical = requireRelative(root, meta.canonical);
    if (relativeCanonical !== relative) internalFailure();
    targets[relative] = meta;
  }
  const descriptors = { request: requestDescriptor, keychain: openStableDescriptor(targets[REQUEST_RELATIVE.keychain].path, targets[REQUEST_RELATIVE.keychain], 64 * 1024 * 1024), launcher: openStableDescriptor(targets[REQUEST_RELATIVE.launcher].path, targets[REQUEST_RELATIVE.launcher], 1024 * 1024), helper: openStableDescriptor(targets[REQUEST_RELATIVE.helper].path, targets[REQUEST_RELATIVE.helper], 1024 * 1024) };
  for (const name of request.alternate_profile_relpaths) descriptors[`alternate:${name}`] = openStableDescriptor(targets[`profiles/alternates/${name}`].path, targets[`profiles/alternates/${name}`], 1024 * 1024);
  if (!keepDescriptors) for (const descriptor of Object.values(descriptors)) closeSync(descriptor.fd);
  return { ...request, task_root: root, request_file: requestMeta.path, dedicated_keychain: targets[REQUEST_RELATIVE.keychain].path, launcher_profile: targets[REQUEST_RELATIVE.launcher].path, helper_profile: targets[REQUEST_RELATIVE.helper].path, alternate_profiles: request.alternate_profile_relpaths.map((name) => targets[`profiles/alternates/${name}`].path), current_user: request.disposable_user, current_uid: request.disposable_uid, task_root_verified: true, default_verified: false, descriptors };
}

function requireRelative(root, target) {
  const relativePath = relative(resolve(root), resolve(target));
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) internalFailure();
  return relativePath.replaceAll('\\', '/');
}

function verifyInventoryPaths(request) {
  const rootStat = lstatSync(noSymlinkPath(request.task_root));
  const verify = (path, descriptor) => {
    const meta = guardedStat(path, 0o600, request.disposable_uid, rootStat.dev);
    if (!descriptor || meta.stat.mode !== descriptor.stat.mode || meta.stat.uid !== descriptor.stat.uid || meta.stat.gid !== descriptor.stat.gid || meta.stat.nlink !== descriptor.stat.nlink || meta.stat.size !== descriptor.stat.size || meta.stat.dev !== descriptor.stat.dev || meta.stat.ino !== descriptor.stat.ino) internalFailure();
  };
  verify(request.request_file, request.descriptors?.request);
  verify(request.dedicated_keychain, request.descriptors?.keychain);
  verify(request.launcher_profile, request.descriptors?.launcher);
  verify(request.helper_profile, request.descriptors?.helper);
  for (const profile of request.alternate_profiles ?? []) verify(profile, request.descriptors?.[`alternate:${profile.split('/').at(-1)}`]);
  if (request.descriptors) verifyHeldDescriptors(request);
}

function verifyHeldDescriptors(request) {
  const descriptors = Object.values(request.descriptors ?? {});
  for (const descriptor of descriptors) {
    const stat = fstatSync(descriptor.fd);
    if (stat.mode !== descriptor.stat.mode || stat.uid !== descriptor.stat.uid || stat.gid !== descriptor.stat.gid || stat.nlink !== descriptor.stat.nlink || stat.size !== descriptor.stat.size || stat.dev !== descriptor.stat.dev || stat.ino !== descriptor.stat.ino) internalFailure();
    if (descriptorContentDigest(descriptor, descriptor.stat.size + 1) !== descriptor.content_digest) internalFailure();
  }
}

function verifyKeychainIdentity(request, expectedDigest) {
  const descriptor = request.descriptors.keychain;
  const stat = fstatSync(descriptor.fd);
  if (stat.mode !== descriptor.stat.mode || stat.uid !== descriptor.stat.uid || stat.gid !== descriptor.stat.gid || stat.nlink !== descriptor.stat.nlink || stat.size !== descriptor.stat.size || stat.dev !== descriptor.stat.dev || stat.ino !== descriptor.stat.ino) internalFailure();
  if (descriptorContentDigest(descriptor, 64 * 1024 * 1024) !== expectedDigest) internalFailure();
  verifyInventoryPaths(request);
  verifyHeldDescriptors(request);
}

async function verifyAclMetadata(request, commandRunner, scratchRoot) {
  if (commandRunner !== runCommand) return true;
  const paths = [request.task_root, join(request.task_root, 'profiles'), join(request.task_root, 'profiles', 'alternates'), request.request_file, request.dedicated_keychain, request.launcher_profile, request.helper_profile, ...(request.alternate_profiles ?? [])];
  for (const path of paths) {
    const result = await commandRunner('/bin/ls', ['-lde', path], scratchRoot, 0);
    if (!result.ok || result.stderr !== '' || /\+/.test(result.stdout) || !/^[bcdlps-][rwx-]{9}/.test(result.stdout)) internalFailure();
  }
  return true;
}

function closeDescriptors(request) {
  for (const descriptor of Object.values(request.descriptors ?? {})) {
    try { closeSync(descriptor.fd); } catch { /* already closed */ }
  }
}

function publicTool(tool, runner, extra = {}) {
  const { _observed: ignored, ...withoutObservation } = tool;
  return { ...withoutObservation, runner, ...extra };
}

function guardedRisk(result) {
  return Boolean(result?.timed_out || result?.oversized || result?.invalid_utf8 || /interaction not allowed|user interaction|prompt|locked keychain/i.test(`${result?.stderr ?? ''}`));
}

export async function collectInventory(taskRoot, requestFile, commandRunner = runCommand, scratchRoot = taskRoot) {
  const request = readRequest(taskRoot, commandRunner === runCommand, true);
  await verifyAclMetadata(request, commandRunner, scratchRoot);
  const observedTool = await collectToolOnly(scratchRoot, commandRunner);
  const observed = observedTool._observed ?? { uid: '', user: '', console_user: '', groups: [] };
  const taskStat = lstatSync(request.task_root);
  const currentMatches = observed.uid === String(request.current_uid) && observed.user === request.current_user;
  const nonAdmin = !observed.groups.includes('admin');
  const privateTask = taskStat.isDirectory() && taskStat.uid === process.getuid() && (taskStat.mode & 0o777) === 0o700;
  const privateHome = privateTask;
  const sharedAccount = observed.user !== '' && observed.user === observed.console_user;
  const runner = { disposable: currentMatches && nonAdmin && privateHome && privateTask && !sharedAccount, current_matches: currentMatches, non_admin: nonAdmin, private_home: privateHome, private_task: privateTask, shared_account: sharedAccount };
  const tool = publicTool(observedTool, runner);
  // Guarded inventory is deliberately unreachable on the ordinary user/tool-only
  // path. It is available only after all explicit disposable-runner and offline
  // gates pass, and every result is parsed in memory before evaluation.
  if (!runner.disposable || !tool.network.offline || tool.inventory_failure) { closeDescriptors(request); return { tool, keychain: { dedicated: false, non_symlink: false, owner_only: false, under_task_root: false, not_default: false, not_login: false, task_root_verified: request.task_root_verified, default_verified: false, content_identity_verified: false, descriptor_binding_verified: false }, identities: [], profiles: [], request: { team_id: request.expected_team_id, profile_roles: ['launcher', 'helper'] } }; }

  const keychainPath = request.dedicated_keychain;
  verifyInventoryPaths(request);
  const defaultKeychain = await commandRunner('/usr/bin/security', ['default-keychain', '-d', 'user'], scratchRoot, 0);
  verifyInventoryPaths(request);
  let defaultPath;
  let defaultVerified = false;
  try {
    if (defaultKeychain.stderr !== '' || !defaultKeychain.ok || Buffer.byteLength(defaultKeychain.stdout, 'utf8') > 4096 || !/^"([^"\\\r\n]+)"\n?$/.test(defaultKeychain.stdout)) throw new Error('default keychain');
    defaultPath = defaultKeychain.stdout.trim().slice(1, -1);
    if (!isAbsolute(defaultPath)) throw new Error('default keychain path');
    const canonicalDefault = realpathSync(noSymlinkPath(defaultPath));
    const canonicalDedicated = realpathSync(noSymlinkPath(keychainPath));
    const defaultStat = lstatSync(canonicalDefault);
    const dedicatedStat = lstatSync(canonicalDedicated);
    const loginPaths = [join(homedir(), 'Library/Keychains/login.keychain-db'), join(homedir(), 'Library/Keychains/login.keychain'), join(request.task_root, 'Library/Keychains/login.keychain-db'), join(request.task_root, 'Library/Keychains/login.keychain')];
    if (canonicalDefault === canonicalDedicated || defaultStat.dev === dedicatedStat.dev && defaultStat.ino === dedicatedStat.ino || loginPaths.some((candidate) => { try { return realpathSync(candidate) === canonicalDedicated; } catch { return false; } })) throw new Error('default keychain collision');
    defaultVerified = true;
  } catch { defaultVerified = false; }
  const baseKeychain = { dedicated: true, non_symlink: true, owner_only: true, under_task_root: true, not_default: defaultVerified, not_login: defaultVerified, task_root_verified: true, default_verified: defaultVerified };
  if (!defaultVerified) { closeDescriptors(request); return { tool: { ...tool, inventory_failure: false }, keychain: { ...baseKeychain, content_identity_verified: false, descriptor_binding_verified: false }, identities: [], profiles: [], request: { team_id: request.expected_team_id, profile_roles: ['launcher', 'helper'] } }; }
  let keychainDigest;
  try { keychainDigest = descriptorContentDigest(request.descriptors.keychain, 64 * 1024 * 1024); } catch { closeDescriptors(request); return { tool: { ...tool, inventory_failure: false }, keychain: { ...baseKeychain, content_identity_verified: false, descriptor_binding_verified: false }, identities: [], profiles: [], request: { team_id: request.expected_team_id, profile_roles: ['launcher', 'helper'] } }; }
  const keychainState = { ...baseKeychain, content_identity_verified: true, descriptor_binding_verified: false };
  verifyKeychainIdentity(request, keychainDigest);
  verifyInventoryPaths(request);
  const identity = await commandRunner('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', '/dev/fd/3'], scratchRoot, 0, undefined, request.descriptors.keychain.fd);
  verifyKeychainIdentity(request, keychainDigest);
  const certificates = await commandRunner('/usr/bin/security', ['find-certificate', '-a', '-p', '/dev/fd/3'], scratchRoot, 0, undefined, request.descriptors.keychain.fd);
  verifyKeychainIdentity(request, keychainDigest);
  const launcherBytes = readDescriptor(request.descriptors.launcher, 1024 * 1024);
  const helperBytes = readDescriptor(request.descriptors.helper, 1024 * 1024);
  const launcher = await commandRunner('/usr/bin/security', ['cms', '-D'], scratchRoot, 0, launcherBytes);
  verifyInventoryPaths(request);
  const helper = await commandRunner('/usr/bin/security', ['cms', '-D'], scratchRoot, 0, helperBytes);
  verifyInventoryPaths(request);
  const guardedBeforeDecode = [defaultKeychain, identity, certificates, launcher, helper];
  if (guardedBeforeDecode.some((result) => guardedRisk(result) || !result?.ok)) { closeDescriptors(request); return { tool: { ...tool, keychain_interaction: guardedBeforeDecode.some(guardedRisk), inventory_failure: true }, keychain: keychainState, identities: [], profiles: [], request: { team_id: request.expected_team_id, profile_roles: ['launcher', 'helper'] } }; }
  keychainState.descriptor_binding_verified = commandRunner !== runCommand && identity.fd3 === true && certificates.fd3 === true;
  const profileLauncher = await commandRunner('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], scratchRoot, 0, launcher.stdout);
  const profileHelper = await commandRunner('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], scratchRoot, 0, helper.stdout);
  const guarded = [defaultKeychain, identity, certificates, launcher, helper, profileLauncher, profileHelper];
  if (guarded.some((result) => guardedRisk(result) || !result?.ok)) { closeDescriptors(request); return { tool: { ...tool, keychain_interaction: guarded.some(guardedRisk), inventory_failure: true }, keychain: keychainState, identities: [], profiles: [], request: { team_id: request.expected_team_id, profile_roles: ['launcher', 'helper'] } }; }
  try {
    const identityValue = identity.stdout.trimStart().startsWith('{') ? parseFindIdentityV1(identity.stdout) : parseNativeFindIdentityV1(identity.stdout);
    const certificateValue = certificates.stdout.includes('-----BEGIN CERTIFICATE-----') ? parseNativePublicCertificatesV1(certificates.stdout) : parsePublicCertificatesV1(certificates.stdout);
    const launcherValue = profileLauncher.stdout.trimStart().startsWith('{') && profileLauncher.stdout.includes('"schema"') ? parseProvisioningProfileV1(profileLauncher.stdout) : { profiles: [parseNativeProfileJsonV1(profileLauncher.stdout, 'launcher')] };
    const helperValue = profileHelper.stdout.trimStart().startsWith('{') && profileHelper.stdout.includes('"schema"') ? parseProvisioningProfileV1(profileHelper.stdout) : { profiles: [parseNativeProfileJsonV1(profileHelper.stdout, 'helper')] };
    // Certificate metadata is retained only as the validated public digest and
    // policy fields consumed by the pure evaluator. Raw command output dies here.
    const identities = identityValue.identities.map((item) => {
      const matches = certificateValue.certificates.filter((candidate) => candidate.fingerprint_sha1 === item.fingerprint_sha1);
      const certificate = matches.length === 1 ? matches[0] : null;
      return certificate ? { ...item, team_id: certificate.team_id, common_name: certificate.common_name, fingerprint_sha256: certificate.fingerprint_sha256, fingerprint_sha1: certificate.fingerprint_sha1, issuer: certificate.issuer, not_before: certificate.not_before, not_after: certificate.not_after, revoked: false, policy_valid: true, private_key_usable: true, public_certificate_match: true } : { ...item, public_certificate_match: false };
    });
    closeDescriptors(request);
    return {
      tool: { ...tool, identity_output_valid: true },
      keychain: keychainState,
      identities,
      profiles: [...launcherValue.profiles, ...helperValue.profiles],
      request: { team_id: request.expected_team_id, profile_roles: ['launcher', 'helper'] },
    };
  } catch {
    closeDescriptors(request);
    closeDescriptors(request);
    return { tool: { ...tool, identity_output_valid: false, inventory_failure: true }, keychain: { ...keychainState, descriptor_binding_verified: false }, identities: [], profiles: [], request: { team_id: request.expected_team_id, profile_roles: ['launcher', 'helper'] } };
  }
}

function baseInput(tool) {
  const { _observed: ignored, ...publicTool } = tool;
  return { tool: publicTool, keychain: { dedicated: false, non_symlink: false, owner_only: false, under_task_root: false, not_default: false, not_login: false, content_identity_verified: false, descriptor_binding_verified: false }, identities: [], profiles: [], request: { team_id: '0000000000', profile_roles: ['launcher', 'helper'] } };
}
function missingTaskRootInput() {
  const zero = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const input = {
    tool: { schema: 'skillmap.m3-03.apple-signing-readiness.tool.v1', arch: 'arm64', runner: { disposable: true, current_matches: true, non_admin: true, private_home: true, private_task: true, shared_account: false }, network: { evidence: true, offline: true, scutil_ok: true, ipv4_ok: true, ipv6_ok: true, route_parsed: true, ipv4_external: false, ipv6_external: false, unverified: false }, clt: { present: true, xcode_select: true }, tools: { swiftc: true, codesign: true, security: true, notarytool: true, stapler: true, plutil: true }, command_output_valid: true, command_output_oversized: false, command_output_invalid_utf8: false, timed_out: false, fingerprint_complete: true, help_fingerprint_complete: true, tool_path_classes: Object.fromEntries(TOOL_LABELS.map((label) => [label, 'system'])), tool_digests: Object.fromEntries(TOOL_LABELS.map((label) => [label, zero])), tool_help_digests: { codesign: zero, security_find_identity: zero, security_cms: zero, stapler: zero, plutil: zero } },
    keychain: { dedicated: false, non_symlink: false, owner_only: false, under_task_root: false, not_default: false, not_login: false, task_root_verified: false, default_verified: false }, identities: [], profiles: [], request: { team_id: '0000000000', profile_roles: ['launcher', 'helper'] },
  };
  input.tool.identity_output_valid = false;
  input.keychain.content_identity_verified = false;
  input.keychain.descriptor_binding_verified = false;
  return input;
}
function makeReceipt(result, mode) {
  return redactAppleSigningReadinessReceiptV1({ result, candidate: { name: 'candidate' }, observed_at: OBSERVED_AT, worktree_integrity: { status: 'not_checked' }, route: { mode } });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskTemp = mkdtempSync(join(tmpdir(), 'skillmap-m303-apple-readiness-'));
  chmodSync(taskTemp, 0o700);
  try {
    let input;
    let now = new Date(OBSERVED_AT);
    if (args.mode === 'fixture') {
      ({ input, now } = fixtureInput(args.fixtureCase));
    } else if (args.mode === 'tool-only') {
      input = baseInput(await collectToolOnly(taskTemp));
    } else {
      try { input = await collectInventory(args.taskRoot, join(args.taskRoot, 'request.json'), undefined, taskTemp); } catch { input = missingTaskRootInput(); }
    }
    const result = evaluateAppleSigningReadinessV1(input, { now });
    const output = makeReceipt(result, args.mode);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.stderr.write(`${result.status}\n`);
    process.exitCode = result.status === APPLE_READINESS_STATUS.READY ? 0 : 2;
  } finally {
    rmSync(taskTemp, { recursive: true, force: false });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch {
    process.stderr.write(`${APPLE_READINESS_STATUS.INVENTORY_FAILURE}\n`);
    process.exitCode = 70;
  }
}
