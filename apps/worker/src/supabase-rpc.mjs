const ALLOWED_RPC = new Set([
  'claim_skill_submission',
  'renew_skill_submission_claim',
  'complete_skill_submission',
  'requeue_skill_submission',
  'dead_letter_expired_skill_submission',
  'publish_skill_submission',
  'list_skill_submission_collisions',
  'review_skill_submission_collisions',
  'record_skill_submission_publisher_authorization',
  'record_skill_submission_license_evidence',
  'get_skill_submission_queue_summary',
  'list_skill_submission_operator_queue',
  'get_skill_submission_operator_detail',
  'disposition_skill_report',
  'list_skill_report_queue',
  'control_catalog_lifecycle'
]);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export function createSupabaseRpcClient(options) {
  const origin = validateOrigin(options?.url);
  const serviceRoleKey = validateSecret(options?.serviceRoleKey);
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error('Supabase RPC timeout must be from 100 through 120000 milliseconds.');
  }

  return Object.freeze({
    async call(name, parameters = {}) {
      if (!ALLOWED_RPC.has(name)) throw new Error('The requested Supabase RPC is not allowlisted.');
      const body = JSON.stringify(parameters);
      if (Buffer.byteLength(body) > 128 * 1024) throw new Error('The Supabase RPC request exceeds the bounded payload limit.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      let response;
      try {
        response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, origin), {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            accept: 'application/json',
            'content-type': 'application/json',
            'user-agent': 'skillmap-hosted-operator/1'
          },
          body
        });
      } catch (error) {
        if (controller.signal.aborted) throw new Error(`Supabase RPC ${name} timed out.`);
        throw new Error(`Supabase RPC ${name} failed before a response.`);
      } finally {
        clearTimeout(timer);
      }
      if (!response || !Number.isInteger(response.status)) throw new Error(`Supabase RPC ${name} returned an invalid response.`);
      const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
      if (!response.ok) {
        let code = 'REMOTE_ERROR';
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed?.code === 'string' && /^[A-Z0-9]{3,10}$/.test(parsed.code)) code = parsed.code;
        } catch {
          // The bounded provider body is intentionally not reflected.
        }
        throw new Error(`Supabase RPC ${name} failed with HTTP ${response.status} (${code}).`);
      }
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Supabase RPC ${name} returned invalid JSON.`);
      }
    }
  });
}

export function createSupabaseRpcClientFromEnvironment(environment = process.env, options = {}) {
  return createSupabaseRpcClient({
    url: environment.SKILLMAP_SUPABASE_URL,
    serviceRoleKey: environment.SKILLMAP_SUPABASE_SERVICE_ROLE_KEY,
    ...options
  });
}

function validateOrigin(raw) {
  if (typeof raw !== 'string' || raw !== raw.trim()) throw new Error('SKILLMAP_SUPABASE_URL is required.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('SKILLMAP_SUPABASE_URL must be a valid origin.');
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('SKILLMAP_SUPABASE_URL must use HTTPS, except for loopback acceptance.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SKILLMAP_SUPABASE_URL must be an origin without credentials, path, query, or fragment.');
  }
  return url.origin;
}

function validateSecret(raw) {
  if (typeof raw !== 'string' || raw.length < 32 || raw.length > 8192 || raw !== raw.trim()
    || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error('SKILLMAP_SUPABASE_SERVICE_ROLE_KEY is required and must be bounded.');
  }
  return raw;
}

async function readBoundedText(response, maximumBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error('Supabase RPC response exceeds the bounded size limit.');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maximumBytes) throw new Error('Supabase RPC response exceeds the bounded size limit.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('Supabase RPC response exceeds the bounded size limit.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}
