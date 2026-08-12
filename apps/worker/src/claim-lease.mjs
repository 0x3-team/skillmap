const SUBMISSION_ID = /^sub_[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Renew the lease held on a claimed skill submission.
 * @param {object} rpc The Supabase RPC client.
 * @param {object} claim The claimed submission.
 * @param {{ workerVersion?: string, leaseSeconds?: number }} [options] Renewal options.
 */
export async function renewClaimLease(rpc, claim, { workerVersion, leaseSeconds = 300 } = {}) {
  if (!rpc || typeof rpc.call !== 'function') throw new Error('Claim lease renewal requires an RPC client.');
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)
    || !SUBMISSION_ID.test(claim.submission_id)
    || !UUID.test(claim.claim_id)) {
    throw new Error('Claim lease renewal received an invalid claim.');
  }
  if (typeof workerVersion !== 'string' || workerVersion.length < 1 || workerVersion.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(workerVersion)) {
    throw new Error('Claim lease renewal received an invalid worker version.');
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
    throw new Error('Claim lease renewal seconds must be from 30 through 900.');
  }
  const rows = await rpc.call('renew_skill_submission_claim', {
    p_submission_id: claim.submission_id,
    p_claim_id: claim.claim_id,
    p_worker_version: workerVersion,
    p_lease_seconds: leaseSeconds
  });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Claim lease renewal returned an invalid bounded result.');
  const renewed = rows[0];
  if (!renewed || typeof renewed !== 'object' || Array.isArray(renewed)
    || renewed.submission_id !== claim.submission_id
    || renewed.claim_id !== claim.claim_id
    || typeof renewed.claim_expires_at !== 'string'
    || !Number.isFinite(Date.parse(renewed.claim_expires_at))) {
    throw new Error('Claim lease renewal returned an invalid claim identity.');
  }
  return renewed;
}
