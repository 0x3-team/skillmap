const ALLOWED_RPC = new Set([
  'approve_operator_action',
  'peek_skill_submission_candidate',
  'claim_skill_submission',
  'defer_skill_submission_provider_limit',
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
  'control_catalog_lifecycle',
  'claim_import_analysis_jobs',
  'renew_import_analysis_job',
  'complete_import_analysis_job',
  'fail_import_analysis_job',
  'claim_import_upload_cleanup',
  'complete_import_upload_cleanup',
  'fail_import_upload_cleanup'
]);
const RPC_SCHEMA = new Map([
  ['claim_import_analysis_jobs', 'analysis_worker_adapter'],
  ['renew_import_analysis_job', 'analysis_worker_adapter'],
  ['complete_import_analysis_job', 'analysis_worker_adapter'],
  ['fail_import_analysis_job', 'analysis_worker_adapter'],
  ['claim_import_upload_cleanup', 'storage_worker_adapter'],
  ['complete_import_upload_cleanup', 'storage_worker_adapter'],
  ['fail_import_upload_cleanup', 'storage_worker_adapter']
]);
const DUAL_CONTROL_EXECUTION_RPC = new Set([
  'record_skill_submission_publisher_authorization',
  'review_skill_submission_collisions',
  'publish_skill_submission',
  'disposition_skill_report',
  'control_catalog_lifecycle'
]);
const DEFAULT_TIMEOUT_MS = 15_000;
// A maximum valid 50-row report page can contain 100,000 Unicode code points.
// Keep one bounded ceiling that admits the schema maximum (including four-byte
// UTF-8 text and JSON framing) while still failing closed on expanded payloads.
const MAX_RESPONSE_BYTES = 512 * 1024;

export function createSupabaseRpcClient(options) {
  const origin = validateOrigin(options?.url);
  const serviceRoleKey = validateSecret(options?.serviceRoleKey);
  const operatorTransport = validateOperatorTransport(options);
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error('Supabase RPC timeout must be from 100 through 120000 milliseconds.');
  }

  return Object.freeze({
    async call(name, parameters = {}) {
      if (!ALLOWED_RPC.has(name)) throw new Error('The requested Supabase RPC is not allowlisted.');
      assertOperatorTransportCall(operatorTransport, name);
      const body = JSON.stringify(parameters);
      if (Buffer.byteLength(body) > 128 * 1024) throw new Error('The Supabase RPC request exceeds the bounded payload limit.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      let response;
      try {
        const profile = RPC_SCHEMA.get(name);
        response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, origin), {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            accept: 'application/json',
            'content-type': 'application/json',
            'user-agent': 'skillmap-hosted-operator/1',
            ...(profile ? { 'accept-profile': profile, 'content-profile': profile } : {}),
            ...(operatorTransport?.headers ?? {})
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

export function createOperatorSupabaseRpcClientFromEnvironment(
  { mode, approvalId = null },
  environment = process.env,
  options = {}
) {
  return createSupabaseRpcClient({
    ...options,
    url: environment.SKILLMAP_SUPABASE_URL,
    serviceRoleKey: environment.SKILLMAP_SUPABASE_SERVICE_ROLE_KEY,
    operatorMode: mode,
    operatorCredential: environment.SKILLMAP_OPERATOR_CREDENTIAL,
    operatorApprovalId: approvalId
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

function validateOperatorTransport(options) {
  const mode = options?.operatorMode ?? null;
  const credential = options?.operatorCredential;
  const approvalId = options?.operatorApprovalId ?? null;
  if (mode === null) {
    if (credential !== undefined || options?.operatorApprovalId !== undefined) {
      throw new Error('Operator transport options require an explicit approve or execute mode.');
    }
    return null;
  }
  if (mode !== 'approve' && mode !== 'execute') {
    throw new Error('Operator transport mode must be approve or execute.');
  }
  if (typeof credential !== 'string' || !/^smo_v1_[0-9a-f]{64}$/.test(credential)) {
    throw new Error('SKILLMAP_OPERATOR_CREDENTIAL is required and invalid.');
  }
  if (mode === 'approve') {
    if (approvalId !== null) throw new Error('Operator approval is accepted only for execute transport.');
    return Object.freeze({
      mode,
      headers: Object.freeze({ 'x-skillmap-operator-credential': credential })
    });
  }
  if (typeof approvalId !== 'string' || !/^opa_[0-9a-f]{32}$/.test(approvalId)) {
    throw new Error('Operator approval is required and invalid for execute transport.');
  }
  return Object.freeze({
    mode,
    headers: Object.freeze({
      'x-skillmap-operator-credential': credential,
      'x-skillmap-operator-approval': approvalId
    })
  });
}

function assertOperatorTransportCall(operatorTransport, name) {
  if (operatorTransport?.mode === 'approve' && name !== 'approve_operator_action') {
    throw new Error('Approve transport may call only the operator approval RPC.');
  }
  if (operatorTransport?.mode === 'execute' && !DUAL_CONTROL_EXECUTION_RPC.has(name)) {
    throw new Error('Execute transport may call only a dual-controlled business RPC.');
  }
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
