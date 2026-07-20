import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalDigest } from '../apps/worker/src/operator-receipts.mjs';
import {
  acceptOperatorMode,
  finalizeOperatorMode,
  runDualControlledOperatorAction
} from '../apps/worker/src/operator-dual-control.mjs';
import {
  createOperatorSupabaseRpcClientFromEnvironment
} from '../apps/worker/src/supabase-rpc.mjs';
import {
  buildPublisherAuthorizationAction,
  parseArguments as parseAuthorization,
  runPublisherAuthorization,
  validatePublisherAuthorizationResult
} from '../apps/worker/src/authorization.mjs';
import {
  buildCollisionReviewAction,
  parseArguments as parseCollisionReview,
  runCollisionReview,
  validateCollisionReviewResult
} from '../apps/worker/src/collision-review.mjs';
import {
  buildPublicationAction,
  parsePublishArguments,
  runPublication,
  validateMetadata,
  validatePublicationResult
} from '../apps/worker/src/publish-once.mjs';
import {
  buildCatalogLifecycleAction,
  parseLifecycleArguments
} from '../apps/worker/src/lifecycle.mjs';
import {
  buildReportDispositionAction,
  parseReportDispositionArguments
} from '../apps/worker/src/report-disposition.mjs';

const SERVICE_SECRET = `service-role-${'s'.repeat(48)}`;
const APPROVER_CREDENTIAL = `smo_v1_${'a'.repeat(64)}`;
const EXECUTOR_CREDENTIAL = `smo_v1_${'b'.repeat(64)}`;
const APPROVAL_ID = `opa_${'c'.repeat(32)}`;
const APPROVER_ID = `opr_${'d'.repeat(32)}`;
const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_ID = `sub_${'1'.repeat(32)}`;
const DIGEST = `sha256:${'2'.repeat(64)}`;
const AUTHORIZATION_RECEIPT_ID = `aut_${'3'.repeat(32)}`;
const COLLISION_REVIEW_ID = `col_${'4'.repeat(32)}`;
const REVIEW_SUBJECT_DIGEST = `sha256:${'5'.repeat(64)}`;
const PUBLISHER_ID = `pub_${'6'.repeat(32)}`;
const SKILL_ID = `skl_${'7'.repeat(32)}`;
const VERSION_ID = `skv_${'8'.repeat(32)}`;

function publicationMetadata() {
  return {
    publisherHandle: 'example-owner', publisherDisplayName: 'Example Owner',
    skillSlug: 'review-skill', skillDisplayName: 'Review Skill', summary: 'A reviewed skill.',
    description: 'A sufficiently detailed reviewed skill description.', capabilities: ['code.review'],
    licenseState: 'confirmed', spdxExpression: 'MIT', permissionScripts: false,
    permissionNetwork: [], permissionTools: []
  };
}

test('operator modes are mutually exclusive and approval IDs are execute-only', () => {
  assert.equal(acceptOperatorMode('--approve', null), 'approve');
  assert.equal(acceptOperatorMode('--execute', null), 'execute');
  assert.equal(acceptOperatorMode('--submission-id', null), null);
  assert.throws(() => acceptOperatorMode('--execute', 'approve'), /Exactly one/);
  assert.throws(() => finalizeOperatorMode(null), /Exactly one/);
  assert.throws(() => finalizeOperatorMode('approve', APPROVAL_ID), /only with --execute/);
  assert.throws(() => finalizeOperatorMode('execute'), /approval-id is required/);
  assert.throws(() => finalizeOperatorMode('execute', `opa_${'A'.repeat(32)}`), /approval-id is required/);
  assert.deepEqual(finalizeOperatorMode('approve'), { mode: 'approve', approvalId: null });
  assert.deepEqual(finalizeOperatorMode('execute', APPROVAL_ID), { mode: 'execute', approvalId: APPROVAL_ID });
});

test('all consequential CLIs require exactly one valid mode tuple', () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const cases = [
    [parseAuthorization, [
      '--submission-id', SUBMISSION_ID, '--publisher-handle', 'example-owner',
      '--decision', 'authorized', '--basis', 'publisher-consent',
      '--evidence-reference', `authref_${'3'.repeat(32)}`,
      '--evidence-digest', DIGEST, '--expires-at', future, '--operation-id', OPERATION_ID
    ]],
    [parseCollisionReview, [
      '--submission-id', SUBMISSION_ID, '--disposition', 'approved-distinct',
      '--reason-code', 'manual-review', '--operation-id', OPERATION_ID
    ]],
    [parsePublishArguments, [
      '--submission-id', SUBMISSION_ID, '--metadata', 'reviewed.json', '--operation-id', OPERATION_ID
    ]],
    [parseLifecycleArguments, [
      '--skill-id', `skl_${'4'.repeat(32)}`, '--action', 'deprecate-skill',
      '--reason-code', 'manual-review', '--operation-id', OPERATION_ID
    ]],
    [parseReportDispositionArguments, [
      '--report-id', `rpt_${'5'.repeat(32)}`, '--disposition', 'no-action',
      '--reason-code', 'not-confirmed', '--public-message', 'No catalog action was required.',
      '--operation-id', OPERATION_ID
    ]]
  ];
  for (const [parse, args] of cases) {
    assert.throws(() => parse([APPROVER_CREDENTIAL]), error => {
      assert.doesNotMatch(error.message, /smo_v1_/);
      return /Unknown option/.test(error.message);
    });
    assert.throws(() => parse(args), /Exactly one of --approve or --execute/);
    assert.throws(() => parse(['--approve', '--execute', ...args]), /Exactly one/);
    assert.throws(() => parse(['--approve', '--approval-id', APPROVAL_ID, ...args]), /only with --execute/);
    assert.throws(() => parse(['--execute', ...args]), /approval-id is required/);
    assert.equal(parse(['--execute', '--approval-id', APPROVAL_ID, ...args]).mode, 'execute');
  }
});

test('operator transport isolates approval and execution headers, retries, and errors', async () => {
  const environment = {
    SKILLMAP_SUPABASE_URL: 'http://127.0.0.1:54321',
    SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: SERVICE_SECRET,
    SKILLMAP_OPERATOR_CREDENTIAL: APPROVER_CREDENTIAL
  };
  const approveRequests = [];
  const approve = createOperatorSupabaseRpcClientFromEnvironment(
    { mode: 'approve' }, environment, {
      fetchImpl: async (url, options) => {
        approveRequests.push({ url: url.toString(), options });
        return new Response(JSON.stringify([{
          approval_id: APPROVAL_ID, action_digest: DIGEST,
          approver_id: APPROVER_ID, expires_at: '2026-07-14T07:00:00.000Z'
        }]), { status: 200 });
      }
    }
  );
  await approve.call('approve_operator_action', { p_action_digest: DIGEST });
  assert.equal(approveRequests[0].options.headers['x-skillmap-operator-credential'], APPROVER_CREDENTIAL);
  assert.equal(approveRequests[0].options.headers['x-skillmap-operator-approval'], undefined);
  await assert.rejects(approve.call('control_catalog_lifecycle', {}), /only the operator approval RPC/);

  const executeRequests = [];
  const execute = createOperatorSupabaseRpcClientFromEnvironment(
    { mode: 'execute', approvalId: APPROVAL_ID },
    { ...environment, SKILLMAP_OPERATOR_CREDENTIAL: EXECUTOR_CREDENTIAL },
    {
      fetchImpl: async (url, options) => {
        executeRequests.push({ url: url.toString(), options });
        return new Response('[]', { status: 200 });
      }
    }
  );
  const parameters = { p_skill_id: `skl_${'4'.repeat(32)}`, p_idempotency_digest: DIGEST };
  await execute.call('control_catalog_lifecycle', parameters);
  await execute.call('control_catalog_lifecycle', parameters);
  assert.equal(executeRequests.length, 2);
  assert.equal(executeRequests[0].options.headers['x-skillmap-operator-credential'], EXECUTOR_CREDENTIAL);
  assert.equal(executeRequests[0].options.headers['x-skillmap-operator-approval'], APPROVAL_ID);
  assert.equal(executeRequests[0].options.body, executeRequests[1].options.body);
  assert.deepEqual(JSON.parse(executeRequests[0].options.body), parameters);
  await assert.rejects(execute.call('approve_operator_action', {}), /only a dual-controlled business RPC/);
  await assert.rejects(execute.call('list_skill_report_queue', {}), /only a dual-controlled business RPC/);

  for (const invalid of [`smo_v1_${'A'.repeat(64)}`, `smo_v1_${'a'.repeat(63)}`, ` ${APPROVER_CREDENTIAL}`]) {
    assert.throws(() => createOperatorSupabaseRpcClientFromEnvironment(
      { mode: 'approve' }, { ...environment, SKILLMAP_OPERATOR_CREDENTIAL: invalid }
    ), error => {
      assert.doesNotMatch(error.message, new RegExp(invalid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return /OPERATOR_CREDENTIAL/.test(error.message);
    });
  }
  assert.throws(() => createOperatorSupabaseRpcClientFromEnvironment(
    { mode: 'execute', approvalId: `opa_${'A'.repeat(32)}` },
    { ...environment, SKILLMAP_OPERATOR_CREDENTIAL: EXECUTOR_CREDENTIAL }
  ), /approval is required and invalid/);

  const remoteLeak = createOperatorSupabaseRpcClientFromEnvironment(
    { mode: 'execute', approvalId: APPROVAL_ID },
    { ...environment, SKILLMAP_OPERATOR_CREDENTIAL: EXECUTOR_CREDENTIAL },
    { fetchImpl: async () => new Response(JSON.stringify({
      code: '42501', message: `${EXECUTOR_CREDENTIAL} ${APPROVAL_ID} ${SERVICE_SECRET}`
    }), { status: 403 }) }
  );
  await assert.rejects(remoteLeak.call('control_catalog_lifecycle', parameters), error => {
    assert.doesNotMatch(error.message, /smo_v1_|opa_|service-role/);
    assert.match(error.message, /HTTP 403 \(42501\)/);
    return true;
  });
});

test('all five action envelopes exactly match SQL payloads and retain business digests', () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const rawFuture = future.toISOString().replace('Z', '+00:00');
  const authorizationOptions = parseAuthorization([
    '--approve', '--submission-id', SUBMISSION_ID, '--publisher-handle', 'example-owner',
    '--decision', 'authorized', '--basis', 'publisher-owner-approval',
    '--evidence-reference', `authref_${'3'.repeat(32)}`, '--evidence-digest', DIGEST,
    '--expires-at', rawFuture, '--operation-id', OPERATION_ID
  ]);
  const authorization = buildPublisherAuthorizationAction(authorizationOptions);
  assert.equal(authorizationOptions.expiresAt, future.toISOString());
  assert.deepEqual(authorization.actionPayload, {
    schemaVersion: 1, submissionId: SUBMISSION_ID, publisherHandle: 'example-owner',
    decision: 'authorized', authorizationBasis: 'publisher-owner-approval',
    evidenceReference: `authref_${'3'.repeat(32)}`, evidenceDigest: DIGEST,
    expiresAt: future.toISOString()
  });
  assert.equal(authorization.actionDigest, canonicalDigest({
    kind: 'skillmap.hosted-publisher-authorization-request', schemaVersion: 1,
    submissionId: SUBMISSION_ID, publisherHandle: 'example-owner', decision: 'authorized',
    basis: 'publisher-owner-approval', evidenceReference: `authref_${'3'.repeat(32)}`,
    evidenceDigest: DIGEST, expiresAt: future.toISOString(), operationId: OPERATION_ID
  }));

  const collision = buildCollisionReviewAction(parseCollisionReview([
    '--approve', '--submission-id', SUBMISSION_ID, '--disposition', 'approved-distinct',
    '--reason-code', 'manual-review', '--operation-id', OPERATION_ID
  ]));
  assert.deepEqual(collision.actionPayload, {
    schemaVersion: 1, submissionId: SUBMISSION_ID, disposition: 'approved-distinct',
    reasonCode: 'manual-review', targetPublisherId: null, targetSkillId: null, targetVersionId: null
  });

  const metadata = validateMetadata(publicationMetadata());
  const publishOptions = parsePublishArguments([
    '--approve', '--submission-id', SUBMISSION_ID, '--metadata', 'reviewed.json',
    '--operation-id', OPERATION_ID
  ]);
  const publication = buildPublicationAction(publishOptions, metadata);
  assert.deepEqual(publication.actionPayload, { schemaVersion: 1, submissionId: SUBMISSION_ID, ...metadata });
  assert.equal(publication.actionDigest, canonicalDigest({
    kind: 'skillmap.hosted-publication-request', schemaVersion: 1,
    submissionId: SUBMISSION_ID, metadata, operationId: OPERATION_ID
  }));
  assert.notEqual(publication.actionDigest, canonicalDigest({
    kind: 'skillmap.hosted-publication-request', schemaVersion: 1,
    submissionId: SUBMISSION_ID, metadata, operationId: '22222222-2222-4222-8222-222222222222'
  }));

  const skillId = `skl_${'4'.repeat(32)}`;
  const versionId = `skv_${'6'.repeat(32)}`;
  const lifecycle = buildCatalogLifecycleAction(parseLifecycleArguments([
    '--approve', '--skill-id', skillId, '--version-id', versionId,
    '--action', 'quarantine-version', '--reason-code', 'manual-review', '--operation-id', OPERATION_ID
  ]));
  assert.equal(lifecycle.subjectType, 'skill-version');
  assert.equal(lifecycle.subjectId, versionId);
  assert.deepEqual(lifecycle.actionPayload, {
    schemaVersion: 1, skillId, versionId, action: 'quarantine-version', reasonCode: 'manual-review'
  });

  const reportId = `rpt_${'5'.repeat(32)}`;
  const report = buildReportDispositionAction(parseReportDispositionArguments([
    '--approve', '--report-id', reportId, '--disposition', 'no-action',
    '--reason-code', 'not-confirmed', '--public-message', 'No catalog action was required.',
    '--operation-id', OPERATION_ID
  ]));
  assert.deepEqual(report.actionPayload, {
    schemaVersion: 1, reportId, dispositionCode: 'no-action', reasonCode: 'not-confirmed',
    publicMessage: 'No catalog action was required.', lifecycleAction: null
  });
  for (const action of [authorization, collision, publication, lifecycle, report]) {
    assert.match(action.actionDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(action.businessParameters.p_idempotency_digest
      ?? action.businessParameters.p_publication_digest, action.actionDigest);
  }
});

test('execute-mode business RPC validators accept and retain exact one-row projections', async () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const authorizationOptions = parseAuthorization([
    '--execute', '--approval-id', APPROVAL_ID,
    '--submission-id', SUBMISSION_ID, '--publisher-handle', 'example-owner',
    '--decision', 'authorized', '--basis', 'publisher-consent',
    '--evidence-reference', `authref_${'9'.repeat(32)}`, '--evidence-digest', DIGEST,
    '--expires-at', future, '--operation-id', OPERATION_ID
  ]);
  const authorizationResult = [{
    authorization_receipt_id: AUTHORIZATION_RECEIPT_ID,
    authorization_decision: 'authorized',
    authorization_expires_at: future.replace('Z', '+00:00')
  }];
  assert.equal(validatePublisherAuthorizationResult(authorizationResult, authorizationOptions), authorizationResult);
  const authorization = await runPublisherAuthorization(authorizationOptions, {
    rpc: { async call() { return authorizationResult; } }
  });
  assert.deepEqual(authorization.authorization, authorizationResult);

  const revocationOptions = parseAuthorization([
    '--execute', '--approval-id', APPROVAL_ID,
    '--submission-id', SUBMISSION_ID, '--publisher-handle', 'example-owner',
    '--decision', 'revoked', '--evidence-reference', `authref_${'a'.repeat(32)}`,
    '--evidence-digest', DIGEST, '--operation-id', OPERATION_ID
  ]);
  const revocationResult = [{
    authorization_receipt_id: `aut_${'b'.repeat(32)}`,
    authorization_decision: 'revoked', authorization_expires_at: null
  }];
  assert.equal(validatePublisherAuthorizationResult(revocationResult, revocationOptions), revocationResult);

  const collisionOptions = parseCollisionReview([
    '--execute', '--approval-id', APPROVAL_ID,
    '--submission-id', SUBMISSION_ID, '--disposition', 'approved-distinct',
    '--reason-code', 'manual-review', '--operation-id', OPERATION_ID
  ]);
  const collisionResult = [{
    collision_review_id: COLLISION_REVIEW_ID,
    review_subject_digest: REVIEW_SUBJECT_DIGEST,
    disposition: 'approved-distinct'
  }];
  assert.equal(validateCollisionReviewResult(collisionResult, collisionOptions), collisionResult);
  const collision = await runCollisionReview(collisionOptions, {
    rpc: { async call() { return collisionResult; } }
  });
  assert.deepEqual(collision.review, collisionResult);

  const metadata = publicationMetadata();
  const publicationOptions = parsePublishArguments([
    '--execute', '--approval-id', APPROVAL_ID,
    '--submission-id', SUBMISSION_ID, '--metadata', 'reviewed.json',
    '--operation-id', OPERATION_ID
  ]);
  const publicationResult = [{
    submission_id: SUBMISSION_ID, publisher_id: PUBLISHER_ID,
    skill_id: SKILL_ID, version_id: VERSION_ID, submission_state: 'published'
  }];
  assert.equal(validatePublicationResult(publicationResult, publicationOptions), publicationResult);
  const publication = await runPublication(publicationOptions, {
    readFile: async () => JSON.stringify(metadata),
    rpc: { async call() { return publicationResult; } }
  });
  assert.deepEqual(publication.publication, publicationResult);
});

test('execute-mode business RPC validators reject malformed or contradictory projections', async () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const authorizationOptions = parseAuthorization([
    '--execute', '--approval-id', APPROVAL_ID,
    '--submission-id', SUBMISSION_ID, '--publisher-handle', 'example-owner',
    '--decision', 'authorized', '--basis', 'publisher-consent',
    '--evidence-reference', `authref_${'9'.repeat(32)}`, '--evidence-digest', DIGEST,
    '--expires-at', future, '--operation-id', OPERATION_ID
  ]);
  const authorizationRow = {
    authorization_receipt_id: AUTHORIZATION_RECEIPT_ID,
    authorization_decision: 'authorized', authorization_expires_at: future
  };
  for (const invalid of [
    null, {}, [], [authorizationRow, authorizationRow], [null], [[]],
    [{ ...authorizationRow, extra: true }],
    [{ authorization_receipt_id: AUTHORIZATION_RECEIPT_ID, authorization_decision: 'authorized' }],
    [{ ...authorizationRow, authorization_receipt_id: `aut_${'A'.repeat(32)}` }],
    [{ ...authorizationRow, authorization_decision: 'revoked' }],
    [{ ...authorizationRow, authorization_expires_at: null }],
    [{ ...authorizationRow, authorization_expires_at: 'not-a-timestamp' }],
    [{ ...authorizationRow, authorization_expires_at: new Date(Date.parse(future) + 1_000).toISOString() }]
  ]) {
    assert.throws(
      () => validatePublisherAuthorizationResult(invalid, authorizationOptions),
      /invalid authorization projection/
    );
  }
  const revocationOptions = parseAuthorization([
    '--execute', '--approval-id', APPROVAL_ID,
    '--submission-id', SUBMISSION_ID, '--publisher-handle', 'example-owner',
    '--decision', 'revoked', '--evidence-reference', `authref_${'a'.repeat(32)}`,
    '--evidence-digest', DIGEST, '--operation-id', OPERATION_ID
  ]);
  assert.throws(() => validatePublisherAuthorizationResult([{
    authorization_receipt_id: AUTHORIZATION_RECEIPT_ID,
    authorization_decision: 'revoked', authorization_expires_at: future
  }], revocationOptions), /invalid authorization projection/);

  const collisionOptions = parseCollisionReview([
    '--execute', '--approval-id', APPROVAL_ID,
    '--submission-id', SUBMISSION_ID, '--disposition', 'approved-distinct',
    '--reason-code', 'manual-review', '--operation-id', OPERATION_ID
  ]);
  const collisionRow = {
    collision_review_id: COLLISION_REVIEW_ID,
    review_subject_digest: REVIEW_SUBJECT_DIGEST,
    disposition: 'approved-distinct'
  };
  for (const invalid of [
    null, {}, [], [collisionRow, collisionRow], [null], [[]],
    [{ ...collisionRow, extra: true }],
    [{ collision_review_id: COLLISION_REVIEW_ID, disposition: 'approved-distinct' }],
    [{ ...collisionRow, collision_review_id: `col_${'A'.repeat(32)}` }],
    [{ ...collisionRow, review_subject_digest: `sha256:${'A'.repeat(64)}` }],
    [{ ...collisionRow, disposition: 'blocked-duplicate' }]
  ]) {
    assert.throws(
      () => validateCollisionReviewResult(invalid, collisionOptions),
      /invalid collision projection/
    );
  }

  const publicationOptions = parsePublishArguments([
    '--execute', '--approval-id', APPROVAL_ID,
    '--submission-id', SUBMISSION_ID, '--metadata', 'reviewed.json',
    '--operation-id', OPERATION_ID
  ]);
  const publicationRow = {
    submission_id: SUBMISSION_ID, publisher_id: PUBLISHER_ID,
    skill_id: SKILL_ID, version_id: VERSION_ID, submission_state: 'published'
  };
  for (const invalid of [
    null, {}, [], [publicationRow, publicationRow], [null], [[]],
    [{ ...publicationRow, extra: true }],
    [{ submission_id: SUBMISSION_ID, publisher_id: PUBLISHER_ID,
      skill_id: SKILL_ID, version_id: VERSION_ID }],
    [{ ...publicationRow, submission_id: `sub_${'f'.repeat(32)}` }],
    [{ ...publicationRow, publisher_id: `pub_${'A'.repeat(32)}` }],
    [{ ...publicationRow, skill_id: `skl_${'A'.repeat(32)}` }],
    [{ ...publicationRow, version_id: `skv_${'A'.repeat(32)}` }],
    [{ ...publicationRow, submission_state: 'accepted' }]
  ]) {
    assert.throws(
      () => validatePublicationResult(invalid, publicationOptions),
      /invalid publication projection/
    );
  }

  await assert.rejects(runPublisherAuthorization(authorizationOptions, {
    rpc: { async call() { return [{ ...authorizationRow, authorization_decision: 'revoked' }]; } }
  }), /invalid authorization projection/);
  await assert.rejects(runCollisionReview(collisionOptions, {
    rpc: { async call() { return [{ ...collisionRow, review_subject_digest: 'invalid' }]; } }
  }), /invalid collision projection/);
  await assert.rejects(runPublication(publicationOptions, {
    readFile: async () => JSON.stringify(publicationMetadata()),
    rpc: { async call() { return [{ ...publicationRow, submission_state: 'accepted' }]; } }
  }), /invalid publication projection/);
});

test('approval calls only approval RPC and execution calls only the unchanged business RPC', async () => {
  const action = buildCollisionReviewAction(parseCollisionReview([
    '--approve', '--submission-id', SUBMISSION_ID, '--disposition', 'approved-distinct',
    '--reason-code', 'manual-review', '--operation-id', OPERATION_ID
  ]));
  const approvalCalls = [];
  const approved = await runDualControlledOperatorAction(action, { rpc: {
    async call(name, parameters) {
      approvalCalls.push([name, parameters]);
      return [{
        approval_id: APPROVAL_ID, action_digest: action.actionDigest,
        approver_id: APPROVER_ID, expires_at: '2026-07-14T07:00:00.000Z'
      }];
    }
  } });
  assert.equal(approved.mode, 'approve');
  assert.deepEqual(approvalCalls, [['approve_operator_action', {
    p_action_kind: action.actionKind, p_subject_type: action.subjectType,
    p_subject_id: action.subjectId, p_action_payload: action.actionPayload,
    p_action_digest: action.actionDigest, p_operation_id: action.operationId
  }]]);

  const executeAction = { ...action, mode: 'execute', approvalId: APPROVAL_ID };
  const executionCalls = [];
  const executed = await runDualControlledOperatorAction(executeAction, { rpc: {
    async call(name, parameters) {
      executionCalls.push([name, parameters]);
      return [{ collision_review_id: `col_${'7'.repeat(32)}` }];
    }
  } });
  assert.equal(executed.mode, 'execute');
  assert.deepEqual(executionCalls, [[action.businessRpc, action.businessParameters]]);
});
