const textEncoder = new TextEncoder();

export const REPLAY_RING_SCHEMA = 'skillmap.device-auth.replay-ring.v1';
export const REPLAY_RING_MAX_BYTES = 4096;
export const REPLAY_RING_MAX_ENTRIES = 4;
export const REPLAY_EPOCH_SECONDS = 300;
export const REPLAY_LOGICAL_SECONDS = 600;
export const REPLAY_PURGE_SECONDS = 900;
export const REPLAY_DESTROY_SKEW_SECONDS = 30;
export const REPLAY_EXPOSURE_BOUND_SECONDS = REPLAY_EPOCH_SECONDS + REPLAY_PURGE_SECONDS + REPLAY_DESTROY_SKEW_SECONDS;

const KEY_BYTES = 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const RING_BRAND = Symbol('skillmap.replay-ring.v1');

export class ReplayRingError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReplayRingError';
    this.code = code;
  }
}

function fail(code) {
  throw new ReplayRingError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function decodeKey(encoded) {
  if (typeof encoded !== 'string' || !BASE64URL.test(encoded) || encoded.includes('=')) fail('invalid_ring');
  let decoded;
  try { decoded = Buffer.from(encoded, 'base64url'); } catch { fail('invalid_ring'); }
  if (decoded.length !== KEY_BYTES || decoded.toString('base64url') !== encoded) fail('invalid_ring');
  return decoded;
}

function normalizeSource(source) {
  if (typeof source === 'string') {
    if (textEncoder.encode(source).byteLength > REPLAY_RING_MAX_BYTES) fail('ring_too_large');
    if (source.length === 0) fail('empty_binding');
    return parseStrictJson(source);
  }
  if (source instanceof Uint8Array) {
    if (source.byteLength > REPLAY_RING_MAX_BYTES) fail('ring_too_large');
    if (source.byteLength >= 3 && source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf) fail('invalid_json');
    let decoded;
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(source); } catch { fail('invalid_json'); }
    if (decoded.length === 0) fail('empty_binding');
    return parseStrictJson(decoded);
  }
  fail('invalid_binding_type');
}

// JSON.parse is intentionally not sufficient here: it accepts the last value
// for a duplicate member, which would make the authenticated ring binding
// depend on the parser/runtime rather than the closed contract. This small
// scanner validates JSON syntax and rejects duplicate decoded member names;
// JSON.parse remains the value materializer after that check.
function parseStrictJson(source) {
  let offset = 0;

  const invalid = () => fail('invalid_json');
  const skipWhitespace = () => {
    while (offset < source.length && /[ \t\r\n]/.test(source[offset])) offset += 1;
  };
  const parseString = () => {
    if (source[offset] !== '"') invalid();
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        try { return JSON.parse(source.slice(start, offset)); } catch { invalid(); }
      }
      if (code < 0x20) invalid();
      if (code === 0x5c) {
        offset += 1;
        if (offset >= source.length) invalid();
        const escape = source[offset];
        if ('"\\/bfnrt'.includes(escape)) { offset += 1; continue; }
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(offset + 1, offset + 5))) invalid();
          offset += 5;
          continue;
        }
        invalid();
      }
      offset += 1;
    }
    invalid();
  };
  const parseNumber = () => {
    const match = source.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) invalid();
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(match[0])) fail('invalid_ring');
    offset += match[0].length;
  };
  const parseValue = () => {
    skipWhitespace();
    const token = source[offset];
    if (token === '"') { parseString(); return; }
    if (token === '{') { parseObject(); return; }
    if (token === '[') { parseArray(); return; }
    if (token === 't' && source.startsWith('true', offset)) { offset += 4; return; }
    if (token === 'f' && source.startsWith('false', offset)) { offset += 5; return; }
    if (token === 'n' && source.startsWith('null', offset)) { offset += 4; return; }
    if (token === '-' || (token >= '0' && token <= '9')) { parseNumber(); return; }
    invalid();
  };
  const parseObject = () => {
    offset += 1;
    skipWhitespace();
    const keys = new Set();
    if (source[offset] === '}') { offset += 1; return; }
    while (offset < source.length) {
      const key = parseString();
      if (keys.has(key)) fail('invalid_ring');
      keys.add(key);
      skipWhitespace();
      if (source[offset] !== ':') invalid();
      offset += 1;
      parseValue();
      skipWhitespace();
      if (source[offset] === '}') { offset += 1; return; }
      if (source[offset] !== ',') invalid();
      offset += 1;
      skipWhitespace();
    }
    invalid();
  };
  const parseArray = () => {
    offset += 1;
    skipWhitespace();
    if (source[offset] === ']') { offset += 1; return; }
    while (offset < source.length) {
      parseValue();
      skipWhitespace();
      if (source[offset] === ']') { offset += 1; return; }
      if (source[offset] !== ',') invalid();
      offset += 1;
      skipWhitespace();
    }
    invalid();
  };

  skipWhitespace();
  parseValue();
  skipWhitespace();
  if (offset !== source.length) invalid();
  try { return JSON.parse(source); } catch { invalid(); }
}

export function parseReplayRingV1(source) {
  const value = normalizeSource(source);
  if (!isPlainObject(value) || !exactKeys(value, ['keys', 'primary', 'schema'])) fail('invalid_ring');
  if (value.schema !== REPLAY_RING_SCHEMA) fail('invalid_ring');
  if (!Number.isSafeInteger(value.primary) || Object.is(value.primary, -0) || value.primary < 0) fail('invalid_ring');
  if (!Array.isArray(value.keys) || value.keys.length === 0) fail('invalid_ring');
  if (value.keys.length > REPLAY_RING_MAX_ENTRIES) fail('too_many_entries');
  const entries = value.keys.map((entry) => {
    if (!isPlainObject(entry) || !exactKeys(entry, ['epoch_id', 'key_b64url'])) fail('invalid_ring');
    if (!Number.isSafeInteger(entry.epoch_id) || Object.is(entry.epoch_id, -0) || entry.epoch_id < 0) fail('invalid_ring');
    return { epochId: entry.epoch_id, key: decodeKey(entry.key_b64url) };
  });
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].epochId >= entries[index].epochId) fail('invalid_ring');
  }
  if (entries.at(-1).epochId !== value.primary) fail('invalid_ring');
  const ring = {
    schema: REPLAY_RING_SCHEMA,
    primary: value.primary,
    keys: Object.freeze(entries.map(({ epochId, key }) => Object.freeze({ epochId, key: Buffer.from(key) }))),
  };
  Object.defineProperty(ring, RING_BRAND, { value: true });
  return Object.freeze(ring);
}

export function readReplayRingBindingV1(binding) {
  return parseReplayRingV1(binding);
}

function assertTimestamp(value, code = 'invalid_time') {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
}

export function selectReplayEpochKey(ringInput, options = {}) {
  const ring = ringInput?.[RING_BRAND] === true && Object.isFrozen(ringInput)
    ? ringInput
    : parseReplayRingV1(ringInput);
  const { responseIssuedAt, now = responseIssuedAt, destroyedEpochIds = [] } = options;
  assertTimestamp(responseIssuedAt);
  assertTimestamp(now);
  if (now < responseIssuedAt) fail('clock_before_issued');
  if (now >= responseIssuedAt + REPLAY_LOGICAL_SECONDS) fail('replay_expired');
  const epochId = Math.floor(responseIssuedAt / REPLAY_EPOCH_SECONDS);
  if (destroyedEpochIds.includes(epochId)) fail('epoch_key_destroyed');
  const selected = ring.keys.find((entry) => entry.epochId === epochId);
  if (!selected) fail('epoch_key_unavailable');
  return { epochId, key: Buffer.from(selected.key) };
}

export function redactedReplayRingSummary(ringInput) {
  if (ringInput?.[RING_BRAND] !== true || !Object.isFrozen(ringInput)) fail('invalid_ring');
  const ring = ringInput;
  return {
    schema: ring.schema,
    primary: ring.primary,
    epochs: ring.keys.map((entry) => entry.epochId),
    key_bytes: 0,
  };
}

export function createFakeReplayKeyProvider(options = {}) {
  const active = new Map();
  const deleted = new Map();
  const destroyed = new Set();
  const expired = new Set();
  const generations = new Map();
  const retainedDeletedVersions = options.retainedDeletedVersions === true;
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const failpoints = new Map();

  if (Array.isArray(options.failpoints)) {
    for (const name of options.failpoints) failpoints.set(name, (failpoints.get(name) ?? 0) + 1);
  } else if (isPlainObject(options.failpoints)) {
    for (const [name, count] of Object.entries(options.failpoints)) {
      if (Number.isSafeInteger(count) && count > 0) failpoints.set(name, count);
      else if (count === true) failpoints.set(name, 1);
    }
  }

  function failpoint(name) {
    const remaining = failpoints.get(name) ?? 0;
    if (remaining > 0) {
      if (remaining === 1) failpoints.delete(name);
      else failpoints.set(name, remaining - 1);
      fail('unavailable');
    }
  }

  function assertEpoch(epochId) {
    if (!Number.isSafeInteger(epochId) || epochId < 0) fail('invalid_epoch');
  }

  function assertKey(value) {
    if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) fail('invalid_key');
    if (value.byteLength !== KEY_BYTES) fail('invalid_key');
  }

  function currentGeneration(epochId) {
    return generations.get(epochId) ?? 0;
  }

  function markExpiredIfNeeded(epochId) {
    const record = active.get(epochId);
    if (record && Number.isSafeInteger(record.expiresAt) && clock() >= record.expiresAt) {
      active.delete(epochId);
      expired.add(epochId);
      return true;
    }
    return false;
  }

  function assertWritableEpoch(epochId) {
    if (destroyed.has(epochId)) fail('destroyed_epoch');
    if (expired.has(epochId) || markExpiredIfNeeded(epochId)) fail('expired_epoch');
  }

  async function read(epochId) {
    assertEpoch(epochId);
    failpoint('unavailable_before_read');
    if (markExpiredIfNeeded(epochId)) fail('expired_epoch');
    const record = active.get(epochId);
    if (!record) return null;
    return { epochId, generation: record.generation, key: Buffer.from(record.key) };
  }

  async function compareAndSwap(epochId, expectedGeneration, value, optionsForWrite = {}) {
    assertEpoch(epochId); assertKey(value);
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) fail('invalid_generation');
    const expiresAt = optionsForWrite.expiresAt ?? Number.POSITIVE_INFINITY;
    if (expiresAt !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(expiresAt) || expiresAt < 0)) fail('invalid_time');
    if (expiresAt !== Number.POSITIVE_INFINITY && clock() >= expiresAt) fail('expired_epoch');
    failpoint('unavailable_before_read');
    assertWritableEpoch(epochId);
    markExpiredIfNeeded(epochId);
    const record = active.get(epochId);
    const current = record ? { epochId, generation: record.generation, key: Buffer.from(record.key) } : null;
    if ((current?.generation ?? 0) !== expectedGeneration) fail('generation_conflict');
    failpoint('unavailable_before_cas');
    const nextGeneration = expectedGeneration + 1;
    generations.set(epochId, nextGeneration);
    active.set(epochId, {
      generation: nextGeneration,
      key: Buffer.from(value),
      expiresAt,
    });
    failpoint('unavailable_after_cas');
    return { epochId, generation: nextGeneration };
  }

  return Object.freeze({
    async put(epochId, value, optionsForWrite = {}) {
      assertEpoch(epochId);
      assertWritableEpoch(epochId);
      if (currentGeneration(epochId) !== 0 || active.has(epochId)) fail('generation_conflict');
      return compareAndSwap(epochId, 0, value, optionsForWrite);
    },
    async read(epochId) {
      return read(epochId);
    },
    async compareAndSwap(epochId, expectedGeneration, value, optionsForWrite = {}) {
      return compareAndSwap(epochId, expectedGeneration, value, optionsForWrite);
    },
    async get(epochId) {
      const record = await read(epochId);
      if (record) return record.key;
      const value = retainedDeletedVersions ? deleted.get(epochId) : null;
      return value ? Buffer.from(value) : null;
    },
    async destroy(epochId, expectedGeneration = undefined) {
      assertEpoch(epochId);
      failpoint('unavailable_during_destroy');
      markExpiredIfNeeded(epochId);
      const value = active.get(epochId);
      const actualGeneration = value?.generation ?? currentGeneration(epochId);
      if (expectedGeneration !== undefined && expectedGeneration !== actualGeneration) fail('generation_conflict');
      if (value && retainedDeletedVersions) deleted.set(epochId, Buffer.from(value.key));
      active.delete(epochId);
      destroyed.add(epochId);
      generations.set(epochId, actualGeneration + 1);
    },
    async restore(entry) {
      if (!isPlainObject(entry) || !Object.hasOwn(entry, 'epoch_id') || !Object.hasOwn(entry, 'key')) fail('invalid_restore');
      assertEpoch(entry.epoch_id); assertKey(entry.key);
      assertWritableEpoch(entry.epoch_id);
      return compareAndSwap(entry.epoch_id, currentGeneration(entry.epoch_id), entry.key, { expiresAt: entry.expiresAt });
    },
    async retrieveAfterDestroy(epochId) {
      return retainedDeletedVersions ? (deleted.has(epochId) ? Buffer.from(deleted.get(epochId)) : null) : null;
    },
    async binding() {
      for (const epochId of active.keys()) markExpiredIfNeeded(epochId);
      const epochs = [...active.keys()].sort((a, b) => a - b).slice(-REPLAY_RING_MAX_ENTRIES);
      return {
        schema: REPLAY_RING_SCHEMA,
        primary: epochs.at(-1) ?? 0,
        keys: epochs.map((epochId) => ({ epoch_id: epochId, key_b64url: active.get(epochId).key.toString('base64url') })),
      };
    },
    async exposureBound() {
      return { seconds: retainedDeletedVersions ? Number.POSITIVE_INFINITY : REPLAY_EXPOSURE_BOUND_SECONDS, observed_at: clock() };
    },
  });
}
