const REPLAY_RING_SCHEMA = 'skillmap.device-auth.replay-ring.v1';
const REPLAY_RING_MAX_ENTRIES = 4;
const REPLAY_RING_MAX_BODY_BYTES = 1024;
const LOCAL_BINDING_NAME = 'REPLAY_BINDING_SUMMARY';
const RAW_TARGET_HEADER = 'x-skillmap-replay-raw-target';
const BASE64URL = /^[A-Za-z0-9_-]+$/;

class ProofError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = (code) => { throw new ProofError(code); };
const response = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store', 'x-skillmap-replay-proof': 'local-only' },
});

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasDotSegment(path) {
  return path.split('/').some((segment) => {
    const decoded = segment.replace(/%2e/gi, '.');
    return decoded === '.' || decoded === '..';
  });
}

function scanNoDuplicateKeys(source) {
  let offset = 0;
  const invalid = () => fail('invalid_json');
  const whitespace = () => { while (/[ \t\r\n]/.test(source[offset] ?? '')) offset += 1; };
  const string = () => {
    if (source[offset] !== '"') invalid();
    const start = offset++;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        try { return JSON.parse(source.slice(start, offset)); } catch { invalid(); }
      }
      if (code < 0x20) invalid();
      if (code === 0x5c) {
        offset += 1;
        const escape = source[offset];
        if ('"\\/bfnrt'.includes(escape)) { offset += 1; continue; }
        if (escape === 'u' && /^[0-9a-fA-F]{4}$/.test(source.slice(offset + 1, offset + 5))) { offset += 5; continue; }
        invalid();
      }
      offset += 1;
    }
    invalid();
  };
  const number = () => {
    const match = source.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) invalid();
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(match[0])) fail('invalid_ring');
    offset += match[0].length;
  };
  const value = () => {
    whitespace();
    const token = source[offset];
    if (token === '"') { string(); return; }
    if (token === '{') { object(); return; }
    if (token === '[') { array(); return; }
    if (source.startsWith('true', offset)) { offset += 4; return; }
    if (source.startsWith('false', offset)) { offset += 5; return; }
    if (source.startsWith('null', offset)) { offset += 4; return; }
    if (token === '-' || (token >= '0' && token <= '9')) { number(); return; }
    invalid();
  };
  const object = () => {
    offset += 1; whitespace();
    const keys = new Set();
    if (source[offset] === '}') { offset += 1; return; }
    while (offset < source.length) {
      const key = string();
      if (keys.has(key)) fail('invalid_ring');
      keys.add(key); whitespace();
      if (source[offset] !== ':') invalid();
      offset += 1; value(); whitespace();
      if (source[offset] === '}') { offset += 1; return; }
      if (source[offset] !== ',') invalid();
      offset += 1; whitespace();
    }
    invalid();
  };
  const array = () => {
    offset += 1; whitespace();
    if (source[offset] === ']') { offset += 1; return; }
    while (offset < source.length) {
      value(); whitespace();
      if (source[offset] === ']') { offset += 1; return; }
      if (source[offset] !== ',') invalid();
      offset += 1; whitespace();
    }
    invalid();
  };
  whitespace(); value(); whitespace();
  if (offset !== source.length) invalid();
}

function parseRing(raw) {
  if (raw.length === 0) fail('empty_binding');
  try { scanNoDuplicateKeys(raw); } catch (error) { throw error; }
  let value;
  try { value = JSON.parse(raw); } catch { fail('invalid_json'); }
  if (!isObject(value) || !exactKeys(value, ['keys', 'primary', 'schema'])) fail('invalid_ring');
  if (value.schema !== REPLAY_RING_SCHEMA || !Number.isSafeInteger(value.primary) || Object.is(value.primary, -0) || value.primary < 0) fail('invalid_ring');
  if (!Array.isArray(value.keys) || value.keys.length === 0) fail('invalid_ring');
  if (value.keys.length > REPLAY_RING_MAX_ENTRIES) fail('too_many_entries');
  const epochs = value.keys.map((entry) => {
    if (!isObject(entry) || !exactKeys(entry, ['epoch_id', 'key_b64url'])) fail('invalid_ring');
    if (!Number.isSafeInteger(entry.epoch_id) || Object.is(entry.epoch_id, -0) || entry.epoch_id < 0) fail('invalid_ring');
    if (typeof entry.key_b64url !== 'string' || !BASE64URL.test(entry.key_b64url) || entry.key_b64url.length !== 43) fail('invalid_ring');
    try {
      const padded = entry.key_b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (entry.key_b64url.length % 4)) % 4);
      const decoded = atob(padded);
      if (decoded.length !== 32 || btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') !== entry.key_b64url) fail('invalid_ring');
    } catch { fail('invalid_ring'); }
    return entry.epoch_id;
  });
  for (let index = 1; index < epochs.length; index += 1) if (epochs[index - 1] >= epochs[index]) fail('invalid_ring');
  if (epochs.at(-1) !== value.primary) fail('invalid_ring');
  return { schema: REPLAY_RING_SCHEMA, primary: value.primary, epochs, key_bytes: 0 };
}

function parseLocalBinding(raw) {
  let value;
  try {
    scanNoDuplicateKeys(raw);
    value = JSON.parse(raw);
  } catch { fail('provider_unavailable'); }
  if (!isObject(value) || !exactKeys(value, ['epochs', 'primary', 'schema']) || value.schema !== REPLAY_RING_SCHEMA) fail('provider_unavailable');
  if (!Number.isSafeInteger(value.primary) || Object.is(value.primary, -0) || value.primary < 0 || !Array.isArray(value.epochs) || value.epochs.length === 0 || value.epochs.length > REPLAY_RING_MAX_ENTRIES) fail('provider_unavailable');
  if (value.epochs.at(-1) !== value.primary || value.epochs.some((epoch, index) => !Number.isSafeInteger(epoch) || Object.is(epoch, -0) || epoch < 0 || (index > 0 && value.epochs[index - 1] >= epoch))) fail('provider_unavailable');
  return { schema: REPLAY_RING_SCHEMA, primary: value.primary, epochs: value.epochs, key_bytes: 0 };
}

async function readBoundedBody(request, invalidBodyCode = 'invalid_json') {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REPLAY_RING_MAX_BODY_BYTES) {
        await reader.cancel();
        fail('invalid_request');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail(invalidBodyCode);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(invalidBodyCode); }
}

export default {
  async fetch(request, env) {
    // A real edge adapter must pass the untouched request-target in this
    // internal header before URL parsing. This fixture requires that local
    // adapter seam so Workerd's normalized Request.url cannot erase aliases.
    const raw = request.headers.get(RAW_TARGET_HEADER);
    const url = new URL(request.url);
    const allowed = (request.method === 'POST' && url.pathname === '/proof/parse')
      || (request.method === 'GET' && url.pathname === '/proof/binding');
    if (!allowed) return response({ error: 'not_found' }, 404);
    if (raw === null) return response({ error: 'invalid_request' }, 400);
    if (hasDotSegment(raw)) return response({ error: 'not_found' }, 404);
    if (url.search) return response({ error: 'invalid_request' }, 400);
    try {
      if (typeof env?.[LOCAL_BINDING_NAME] !== 'string') fail('provider_unavailable');
      if (request.method === 'GET') {
        const contentLength = request.headers.get('content-length');
        if ((contentLength !== null && contentLength !== '0') || request.headers.has('transfer-encoding')) fail('invalid_request');
        const body = await readBoundedBody(request, 'invalid_request');
        if (body.length !== 0) fail('invalid_request');
        return response({ status: 'ok', ...parseLocalBinding(env[LOCAL_BINDING_NAME]) });
      }
      if (request.headers.get('content-type') !== 'application/json') fail('invalid_request');
      return response({ status: 'ok', ...parseRing(await readBoundedBody(request)) });
    } catch (error) {
      const code = error instanceof ProofError ? error.code : 'invalid_request';
      const status = code === 'provider_unavailable' ? 503 : 400;
      return response({ error: code }, status);
    }
  },
};
