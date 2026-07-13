import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { prepareInitialCorpus } from '../scripts/initial-corpus-prepare.mjs';

const SCRIPT = 'scripts/initial-corpus-prepare.mjs';

function buildManifest({ count = 20, groups = 5 } = {}) {
  return {
    kind: 'skillmap.initial-corpus-manifest',
    schemaVersion: 1,
    entries: Array.from({ length: count }, (_, index) => {
      const owner = `publisher${index}`;
      const repositoryUrl = `https://github.com/${owner}/skills`;
      const commit = index.toString(16).padStart(40, '0');
      return {
        id: `skill-${index.toString().padStart(2, '0')}`,
        group: `group-${index % groups}`,
        publisher: {
          githubHandle: owner,
          displayName: `Publisher ${index}`,
          profileUrl: `https://github.com/${owner}`,
          identityBasis: 'repository-owner'
        },
        source: {
          repositoryUrl,
          commit,
          path: `skills/skill-${index}/SKILL.md`
        },
        versionLabel: `commit-${commit.slice(0, 12)}`,
        licenseEvidence: {
          spdxExpression: 'MIT',
          repositoryUrl,
          commit,
          path: 'LICENSE'
        },
        authorizationEvidence: {
          state: 'pending-publisher-consent',
          licenseBasis: {
            state: 'operator-reviewed',
            basis: 'repository-license',
            reviewReference: `license-review-${index}`
          },
          publisherConsent: {
            state: 'pending'
          },
          scope: 'metadata-only-catalog-citation'
        }
      };
    })
  };
}

test('prepares a deterministic, bounded artifact without claiming downstream authority', () => {
  const manifest = buildManifest();
  const forward = prepareInitialCorpus(manifest);
  const reversed = prepareInitialCorpus({ ...manifest, entries: [...manifest.entries].reverse() });

  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward.counts, { entries: 20, groups: 5 });
  assert.match(forward.sourceManifestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(forward.operatorState, 'prepared-only');
  assert.equal(forward.authorizationState, 'pending-publisher-consent');
  assert.deepEqual(forward.authorityBoundary, {
    networkContacted: false,
    productionContacted: false,
    databaseMutated: false,
    auditRun: false,
    gradeAssigned: false,
    publicationClaimed: false
  });
  assert.equal(forward.submissions[0].status, 'blocked-pending-publisher-consent');
  assert.equal(forward.submissions[0].publisherIdentity.authorizationImplied, false);
  assert.equal(forward.submissions[0].publisherIdentity.operatorVerificationRequired, true);
  assert.equal(forward.submissions[0].licenseEvidence.operatorVerificationRequired, true);
  assert.deepEqual(forward.submissions[0].executionBoundary, {
    submissionPermitted: false,
    mutatingCommandEmitted: false,
    reason: 'publisher-consent-pending'
  });
  assert.deepEqual(forward.submissions[0].authorizationEvidence, {
    state: 'pending-publisher-consent',
    licenseBasis: {
      state: 'operator-reviewed',
      basis: 'repository-license',
      reviewReference: 'license-review-0',
      evidenceUrl: forward.submissions[0].licenseEvidence.evidenceUrl,
      reviewClaimVerifiedByTool: false
    },
    publisherConsent: {
      state: 'pending',
      authorizationImpliedByVisibility: false
    },
    scope: 'metadata-only-catalog-citation',
    submissionAuthorityGranted: false,
    publisherConsentRequired: true,
    operatorReviewRequired: true
  });
  assert.match(forward.submissions[0].licenseEvidence.evidenceUrl, /\/blob\/[0-9a-f]{40}\/LICENSE$/);
  assert.deepEqual(Object.keys(forward.submissions[0].submissionDraft), [
    'repositoryUrl', 'commit', 'path', 'versionLabel', 'licenseClaim'
  ]);
  assert.doesNotMatch(JSON.stringify(forward), /"command"|npm run|curl |fetch\(/i);
});

test('requires at least 20 entries across at least five groups', () => {
  assert.throws(() => prepareInitialCorpus(buildManifest({ count: 19 })), /20 through 100/);
  assert.throws(() => prepareInitialCorpus(buildManifest({ groups: 4 })), /at least 5 distinct groups/);
  assert.throws(() => prepareInitialCorpus(buildManifest({ count: 101 })), /20 through 100/);
});

test('rejects duplicate corpus ids and exact source coordinates', () => {
  const duplicateId = buildManifest();
  duplicateId.entries[1].id = duplicateId.entries[0].id;
  assert.throws(() => prepareInitialCorpus(duplicateId), /duplicates corpus entry id/);

  const duplicateSource = buildManifest();
  duplicateSource.entries[1].source = { ...duplicateSource.entries[0].source };
  duplicateSource.entries[1].publisher = { ...duplicateSource.entries[0].publisher };
  assert.throws(() => prepareInitialCorpus(duplicateSource), /duplicates an exact repository, commit, and path coordinate/);
});

test('rejects mutable refs, unsafe paths, and non-entrypoint source paths', () => {
  for (const [field, value, expected] of [
    ['commit', 'main', /source\.commit is invalid/],
    ['path', '../SKILL.md', /safe relative POSIX path/],
    ['path', 'skills//SKILL.md', /safe relative POSIX path/],
    ['path', 'skills/demo.md', /ending in SKILL\.md/]
  ]) {
    const manifest = buildManifest();
    manifest.entries[0].source[field] = value;
    assert.throws(() => prepareInitialCorpus(manifest), expected, `${field}=${value}`);
  }
});

test('rejects missing, unknown, and nested unknown fields', () => {
  const topLevel = buildManifest();
  topLevel.unreviewed = true;
  assert.throws(() => prepareInitialCorpus(topLevel), /unknown field "unreviewed"/);

  const entry = buildManifest();
  entry.entries[0].auditState = 'passed';
  assert.throws(() => prepareInitialCorpus(entry), /unknown field "auditState"/);

  const nested = buildManifest();
  nested.entries[0].licenseEvidence.confirmed = true;
  assert.throws(() => prepareInitialCorpus(nested), /unknown field "confirmed"/);

  const missing = buildManifest();
  delete missing.entries[0].publisher;
  assert.throws(() => prepareInitialCorpus(missing), /missing required field "publisher"/);
});

test('requires exact-commit license evidence and a matching repository-owner identity', () => {
  const unresolvedLicense = buildManifest();
  unresolvedLicense.entries[0].licenseEvidence.spdxExpression = 'NOASSERTION';
  assert.throws(() => prepareInitialCorpus(unresolvedLicense), /reviewable license expression/);

  const differentCommit = buildManifest();
  differentCommit.entries[0].licenseEvidence.commit = 'f'.repeat(40);
  assert.throws(() => prepareInitialCorpus(differentCommit), /same exact repository and commit/);

  const differentOwner = buildManifest();
  differentOwner.entries[0].publisher.githubHandle = 'someone-else';
  differentOwner.entries[0].publisher.profileUrl = 'https://github.com/someone-else';
  assert.throws(() => prepareInitialCorpus(differentOwner), /match the source repository owner/);

  const unboundIdentity = buildManifest();
  unboundIdentity.entries[0].publisher.identityBasis = 'claimed-maintainer';
  assert.throws(() => prepareInitialCorpus(unboundIdentity), /must be "repository-owner"/);
});

test('requires explicit authorization evidence and preserves its pending state', () => {
  const missing = buildManifest();
  delete missing.entries[0].authorizationEvidence;
  assert.throws(() => prepareInitialCorpus(missing), /missing required field "authorizationEvidence"/);

  const fabricatedApproval = buildManifest();
  fabricatedApproval.entries[0].authorizationEvidence.state = 'approved';
  assert.throws(() => prepareInitialCorpus(fabricatedApproval), /must remain "pending-publisher-consent"/);

  const visibilityOnly = buildManifest();
  visibilityOnly.entries[0].authorizationEvidence.licenseBasis.basis = 'public-repository';
  assert.throws(() => prepareInitialCorpus(visibilityOnly), /licenseBasis\.basis must be "repository-license"/);

  const unreviewedLicense = buildManifest();
  unreviewedLicense.entries[0].authorizationEvidence.licenseBasis.state = 'pending';
  assert.throws(() => prepareInitialCorpus(unreviewedLicense), /licenseBasis\.state must be "operator-reviewed"/);

  const consentClaim = buildManifest();
  consentClaim.entries[0].authorizationEvidence.publisherConsent.state = 'granted';
  assert.throws(() => prepareInitialCorpus(consentClaim), /publisherConsent\.state must remain "pending"/);

  const overbroad = buildManifest();
  overbroad.entries[0].authorizationEvidence.scope = 'publisher-endorsement';
  assert.throws(() => prepareInitialCorpus(overbroad), /must be "metadata-only-catalog-citation"/);
});

test('CLI writes an owner-only artifact, refuses overwrite, and documents the non-mutating boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skillmap-initial-corpus-'));
  const input = join(directory, 'manifest.json');
  const output = join(directory, 'prepared.json');
  await writeFile(input, `${JSON.stringify(buildManifest())}\n`);

  const prepared = spawnSync(process.execPath, [SCRIPT, '--input', input, '--output', output], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.match(prepared.stdout, /Prepared 20 entries across 5 groups/);
  assert.match(prepared.stdout, /No network, production, audit, grade, or publication action/);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).submissions.length, 20);

  const overwrite = spawnSync(process.execPath, [SCRIPT, '--input', input, '--output', output], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /EEXIST|file already exists/i);

  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /does not use the network/i);
  assert.match(help.stdout, /Public visibility never establishes publisher\s+authorization or submission authority/i);
  assert.match(help.stdout, /does not.*assign a\s+grade/i);
  assert.match(help.stdout, /Existing output files are never overwritten/i);
});

test('CLI rejects unknown and duplicate options', () => {
  for (const args of [
    ['--unknown', 'value'],
    ['--input', 'one.json', '--input', 'two.json']
  ]) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown option|only once/);
  }
});
