#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MIN_ENTRIES = 20;
const MAX_ENTRIES = 100;
const MIN_GROUPS = 5;
const MAX_INPUT_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const GROUP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const GITHUB_REPOSITORY_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9.-]{0,99})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})$/;
const GITHUB_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/;
const SPDX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .()+-]{1,127}$/;
const SAFE_TEXT_PATTERN = /^[^\u0000-\u001F\u007F]+$/;

const TOP_LEVEL_FIELDS = new Set(['kind', 'schemaVersion', 'entries']);
const ENTRY_FIELDS = new Set(['id', 'group', 'publisher', 'source', 'versionLabel', 'licenseEvidence', 'authorizationEvidence']);
const PUBLISHER_FIELDS = new Set(['githubHandle', 'displayName', 'profileUrl', 'identityBasis']);
const SOURCE_FIELDS = new Set(['repositoryUrl', 'commit', 'path']);
const LICENSE_FIELDS = new Set(['spdxExpression', 'repositoryUrl', 'commit', 'path']);
const AUTHORIZATION_FIELDS = new Set(['state', 'licenseBasis', 'publisherConsent', 'scope']);
const LICENSE_BASIS_FIELDS = new Set(['state', 'basis', 'reviewReference']);
const PUBLISHER_CONSENT_FIELDS = new Set(['state']);

export function prepareInitialCorpus(manifest) {
  assertPlainObject(manifest, 'manifest');
  assertKnownFields(manifest, TOP_LEVEL_FIELDS, 'manifest');
  if (manifest.kind !== 'skillmap.initial-corpus-manifest') {
    throw new Error('manifest.kind must be "skillmap.initial-corpus-manifest".');
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error('manifest.schemaVersion must be 1.');
  }
  if (!Array.isArray(manifest.entries)) {
    throw new Error('manifest.entries must be an array.');
  }
  if (manifest.entries.length < MIN_ENTRIES || manifest.entries.length > MAX_ENTRIES) {
    throw new Error(`manifest.entries must contain from ${MIN_ENTRIES} through ${MAX_ENTRIES} entries.`);
  }

  const ids = new Set();
  const coordinates = new Set();
  const entries = manifest.entries.map((entry, index) => normalizeEntry(entry, index, ids, coordinates));
  const groups = new Set(entries.map(entry => entry.group));
  if (groups.size < MIN_GROUPS) {
    throw new Error(`manifest.entries must cover at least ${MIN_GROUPS} distinct groups.`);
  }

  entries.sort((left, right) => left.group.localeCompare(right.group) || left.id.localeCompare(right.id));
  const normalizedManifest = {
    kind: 'skillmap.initial-corpus-manifest',
    schemaVersion: 1,
    entries
  };
  const sourceManifestDigest = sha256Digest(canonicalJson(normalizedManifest));

  return {
    kind: 'skillmap.initial-corpus-preparation',
    schemaVersion: 1,
    sourceManifestDigest,
    counts: {
      entries: entries.length,
      groups: groups.size
    },
    authorityBoundary: {
      networkContacted: false,
      productionContacted: false,
      databaseMutated: false,
      auditRun: false,
      gradeAssigned: false,
      publicationClaimed: false
    },
    operatorState: 'prepared-only',
    authorizationState: 'pending-publisher-consent',
    submissions: entries.map((entry, index) => ({
      sequence: index + 1,
      corpusEntryId: entry.id,
      group: entry.group,
      publisherIdentity: {
        ...entry.publisher,
        authorizationImplied: false,
        operatorVerificationRequired: true
      },
      submissionDraft: {
        repositoryUrl: entry.source.repositoryUrl,
        commit: entry.source.commit,
        path: entry.source.path,
        versionLabel: entry.versionLabel,
        licenseClaim: entry.licenseEvidence.spdxExpression
      },
      licenseEvidence: {
        ...entry.licenseEvidence,
        evidenceUrl: `${entry.licenseEvidence.repositoryUrl}/blob/${entry.licenseEvidence.commit}/${entry.licenseEvidence.path}`,
        operatorVerificationRequired: true
      },
      authorizationEvidence: {
        state: entry.authorizationEvidence.state,
        scope: entry.authorizationEvidence.scope,
        licenseBasis: {
          ...entry.authorizationEvidence.licenseBasis,
          evidenceUrl: `${entry.licenseEvidence.repositoryUrl}/blob/${entry.licenseEvidence.commit}/${entry.licenseEvidence.path}`,
          reviewClaimVerifiedByTool: false
        },
        publisherConsent: {
          ...entry.authorizationEvidence.publisherConsent,
          authorizationImpliedByVisibility: false
        },
        submissionAuthorityGranted: false,
        publisherConsentRequired: true,
        operatorReviewRequired: true
      },
      executionBoundary: {
        submissionPermitted: false,
        mutatingCommandEmitted: false,
        reason: 'publisher-consent-pending'
      },
      status: 'blocked-pending-publisher-consent'
    })),
    requiredNextActions: [
      'Verify each publisher identity and exact-commit license review record.',
      'Obtain and review publisher consent before authorizing submission.',
      'Submit through an authenticated, quota-aware account workflow.',
      'Run the constrained worker and review its evidence separately.',
      'Do not claim a grade or publication until their independent gates pass.'
    ]
  };
}

function normalizeEntry(entry, index, ids, coordinates) {
  const label = `manifest.entries[${index}]`;
  assertPlainObject(entry, label);
  assertKnownFields(entry, ENTRY_FIELDS, label);
  assertString(entry.id, `${label}.id`, { min: 1, max: 64, pattern: ID_PATTERN });
  assertString(entry.group, `${label}.group`, { min: 1, max: 64, pattern: GROUP_PATTERN });
  if (ids.has(entry.id)) throw new Error(`${label}.id duplicates corpus entry id "${entry.id}".`);
  ids.add(entry.id);

  const publisher = normalizePublisher(entry.publisher, `${label}.publisher`);
  const source = normalizeSource(entry.source, `${label}.source`, true);
  const sourceMatch = GITHUB_REPOSITORY_PATTERN.exec(source.repositoryUrl);
  if (sourceMatch[1].toLowerCase() !== publisher.githubHandle.toLowerCase()) {
    throw new Error(`${label}.publisher.githubHandle must match the source repository owner.`);
  }

  const coordinate = `${source.repositoryUrl.toLowerCase()}\u0000${source.commit}\u0000${source.path}`;
  if (coordinates.has(coordinate)) {
    throw new Error(`${label}.source duplicates an exact repository, commit, and path coordinate.`);
  }
  coordinates.add(coordinate);

  assertString(entry.versionLabel, `${label}.versionLabel`, { min: 1, max: 100, pattern: SAFE_TEXT_PATTERN });
  const licenseEvidence = normalizeLicenseEvidence(entry.licenseEvidence, `${label}.licenseEvidence`);
  if (
    licenseEvidence.repositoryUrl.toLowerCase() !== source.repositoryUrl.toLowerCase()
    || licenseEvidence.commit !== source.commit
  ) {
    throw new Error(`${label}.licenseEvidence must be bound to the same exact repository and commit as the source.`);
  }
  const authorizationEvidence = normalizeAuthorizationEvidence(
    entry.authorizationEvidence,
    `${label}.authorizationEvidence`
  );

  return {
    id: entry.id,
    group: entry.group,
    publisher,
    source,
    versionLabel: entry.versionLabel,
    licenseEvidence,
    authorizationEvidence
  };
}

function normalizePublisher(publisher, label) {
  assertPlainObject(publisher, label);
  assertKnownFields(publisher, PUBLISHER_FIELDS, label);
  assertString(publisher.githubHandle, `${label}.githubHandle`, { min: 1, max: 100, pattern: GITHUB_HANDLE_PATTERN });
  assertString(publisher.displayName, `${label}.displayName`, { min: 1, max: 120, pattern: SAFE_TEXT_PATTERN });
  const expectedProfileUrl = `https://github.com/${publisher.githubHandle}`;
  if (publisher.profileUrl !== expectedProfileUrl) {
    throw new Error(`${label}.profileUrl must be the canonical GitHub profile URL ${expectedProfileUrl}.`);
  }
  if (publisher.identityBasis !== 'repository-owner') {
    throw new Error(`${label}.identityBasis must be "repository-owner".`);
  }
  return {
    githubHandle: publisher.githubHandle,
    displayName: publisher.displayName,
    profileUrl: publisher.profileUrl,
    identityBasis: publisher.identityBasis
  };
}

function normalizeSource(source, label, requireSkillEntrypoint) {
  assertPlainObject(source, label);
  assertKnownFields(source, SOURCE_FIELDS, label);
  assertString(source.repositoryUrl, `${label}.repositoryUrl`, {
    min: 20,
    max: 226,
    pattern: GITHUB_REPOSITORY_PATTERN
  });
  assertString(source.commit, `${label}.commit`, { min: 40, max: 40, pattern: COMMIT_PATTERN });
  assertSafePath(source.path, `${label}.path`, { requireSkillEntrypoint });
  return {
    repositoryUrl: source.repositoryUrl,
    commit: source.commit,
    path: source.path
  };
}

function normalizeLicenseEvidence(evidence, label) {
  assertPlainObject(evidence, label);
  assertKnownFields(evidence, LICENSE_FIELDS, label);
  assertString(evidence.spdxExpression, `${label}.spdxExpression`, { min: 2, max: 128, pattern: SPDX_PATTERN });
  if (['NOASSERTION', 'NONE', 'UNKNOWN'].includes(evidence.spdxExpression.toUpperCase())) {
    throw new Error(`${label}.spdxExpression must state a reviewable license expression.`);
  }
  const source = normalizeSource({
    repositoryUrl: evidence.repositoryUrl,
    commit: evidence.commit,
    path: evidence.path
  }, label, false);
  return {
    spdxExpression: evidence.spdxExpression,
    repositoryUrl: source.repositoryUrl,
    commit: source.commit,
    path: source.path
  };
}

function normalizeAuthorizationEvidence(evidence, label) {
  assertPlainObject(evidence, label);
  assertKnownFields(evidence, AUTHORIZATION_FIELDS, label);
  if (evidence.state !== 'pending-publisher-consent') {
    throw new Error(`${label}.state must remain "pending-publisher-consent" until publisher consent is reviewed.`);
  }
  if (evidence.scope !== 'metadata-only-catalog-citation') {
    throw new Error(`${label}.scope must be "metadata-only-catalog-citation".`);
  }
  assertPlainObject(evidence.licenseBasis, `${label}.licenseBasis`);
  assertKnownFields(evidence.licenseBasis, LICENSE_BASIS_FIELDS, `${label}.licenseBasis`);
  if (evidence.licenseBasis.state !== 'operator-reviewed') {
    throw new Error(`${label}.licenseBasis.state must be "operator-reviewed".`);
  }
  if (evidence.licenseBasis.basis !== 'repository-license') {
    throw new Error(`${label}.licenseBasis.basis must be "repository-license".`);
  }
  assertString(evidence.licenseBasis.reviewReference, `${label}.licenseBasis.reviewReference`, {
    min: 3,
    max: 128,
    pattern: ID_PATTERN
  });
  assertPlainObject(evidence.publisherConsent, `${label}.publisherConsent`);
  assertKnownFields(evidence.publisherConsent, PUBLISHER_CONSENT_FIELDS, `${label}.publisherConsent`);
  if (evidence.publisherConsent.state !== 'pending') {
    throw new Error(`${label}.publisherConsent.state must remain "pending".`);
  }
  return {
    state: evidence.state,
    licenseBasis: {
      state: evidence.licenseBasis.state,
      basis: evidence.licenseBasis.basis,
      reviewReference: evidence.licenseBasis.reviewReference
    },
    publisherConsent: {
      state: evidence.publisherConsent.state
    },
    scope: evidence.scope
  };
}

function assertSafePath(value, label, { requireSkillEntrypoint }) {
  assertString(value, label, { min: 1, max: 500, pattern: SAFE_TEXT_PATTERN });
  const segments = value.split('/');
  if (
    value.startsWith('/')
    || value.includes('\\')
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')
    || (requireSkillEntrypoint && segments.at(-1) !== 'SKILL.md')
  ) {
    throw new Error(`${label} must be a safe relative POSIX path${requireSkillEntrypoint ? ' ending in SKILL.md' : ''}.`);
  }
}

function assertString(value, label, { min, max, pattern }) {
  if (typeof value !== 'string' || value.length < min || value.length > max || !pattern.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertKnownFields(value, knownFields, label) {
  for (const field of Object.keys(value)) {
    if (!knownFields.has(field)) throw new Error(`${label} contains unknown field "${field}".`);
  }
  for (const field of knownFields) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label} is missing required field "${field}".`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseArguments(argv) {
  const result = { help: false, input: null, output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--help' || option === '-h') {
      if (seen.has('help')) throw new Error('--help may be provided only once.');
      seen.add('help');
      result.help = true;
      continue;
    }
    if (option !== '--input' && option !== '--output') throw new Error(`Unknown option: ${option}`);
    if (seen.has(option)) throw new Error(`${option} may be provided only once.`);
    seen.add(option);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
    result[option.slice(2)] = value;
    index += 1;
  }
  return result;
}

async function run(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  if (!options.input || !options.output) throw new Error('--input and --output are required.');
  const input = await readBoundedFile(options.input, MAX_INPUT_BYTES);
  let manifest;
  try {
    manifest = JSON.parse(input);
  } catch {
    throw new Error('Input manifest is not valid JSON.');
  }
  const artifact = prepareInitialCorpus(manifest);
  const output = `${JSON.stringify(artifact, null, 2)}\n`;
  if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) throw new Error('Prepared artifact exceeds its output boundary.');
  const handle = await open(options.output, 'wx', 0o600);
  try {
    await handle.writeFile(output, { encoding: 'utf8' });
  } finally {
    await handle.close();
  }
  process.stdout.write(`Prepared ${artifact.counts.entries} entries across ${artifact.counts.groups} groups at ${options.output}.\n`);
  process.stdout.write('No network, production, audit, grade, or publication action was performed.\n');
}

async function readBoundedFile(path, maxBytes) {
  const content = await readFile(path);
  if (content.byteLength > maxBytes) throw new Error(`Input manifest exceeds ${maxBytes} bytes.`);
  return content.toString('utf8');
}

function helpText() {
  return `SkillMap deterministic initial-corpus preparer

Usage:
  node scripts/initial-corpus-prepare.mjs --input MANIFEST.json --output PREPARED.json

Validates 20-100 exact public GitHub source coordinates across at least five
groups, exact-commit license evidence, repository-owner publisher identity, and
an authorization record that separates an operator-reviewed license basis from
pending publisher consent. Public visibility never establishes publisher
authorization or submission authority.
The output is a bounded, owner-only operator preparation artifact. This command
does not use the network, contact production, submit rows, run an audit, assign a
grade, or claim publication. Existing output files are never overwritten.
`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Initial corpus preparation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
