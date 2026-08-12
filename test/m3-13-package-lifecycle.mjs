import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { logoutCommand } from '../dist/commands/logout.js';
import {
  assertFilesPreserved,
  createLifecycleWorkspace,
  createReviewedTarballs,
  globalCli,
  installGlobal,
  mockLocalLogout,
  removeOwnedFixtures,
  runConsumerInstall,
  runCli,
  snapshotPath,
  assertPathPreserved,
  describeFiles,
  snapshotFiles,
  uninstallGlobal
} from './support/m3-13-package-lifecycle.mjs';

const repo = path.resolve(import.meta.dirname, '..');

test('M3.13 package lifecycle is a reviewed offline two-version sequence', { timeout: 180_000 }, async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-m3-13-lifecycle-'));
  const artifactRoot = path.join(repo, '.tmp', 'm3-13-package-lifecycle', `run-${Date.now()}-${process.pid}`);
  mkdirSync(artifactRoot, { recursive: true });
  try {
    const [prior, candidate] = createReviewedTarballs(repo, scratch, artifactRoot);
    assert.notEqual(prior.version, candidate.version);
    assert.notEqual(prior.sha256, candidate.sha256);
    assert.ok(prior.bytes > 0 && candidate.bytes > 0);

    // Run the exact consumer verifier against each retained reviewed tarball.
    // It records observed canary marker state rather than a hardcoded claim.
    const consumerReceipts = [
      runConsumerInstall(repo, prior, artifactRoot),
      runConsumerInstall(repo, candidate, artifactRoot)
    ];

    const workspace = createLifecycleWorkspace(scratch);
    const preserved = snapshotFiles(workspace.preserved);
    const preservedDetails = describeFiles(workspace.preserved);
    const credentialBefore = snapshotPath(workspace.credential);
    const credentialTransitions = [];
    const prefix = path.join(scratch, 'global-prefix');
    const rollbackArtifacts = path.join(artifactRoot, 'rollback-receipt');
    mkdirSync(rollbackArtifacts, { recursive: true });

    // Keep the existing exact rollback gate authoritative for the basic
    // prior -> candidate -> prior -> candidate install sequence.
    execFileSync(process.execPath, [path.join(repo, 'scripts', 'test-package-upgrade-rollback.mjs'), '--required'], {
      cwd: repo,
      env: {
        ...process.env,
        SKILLMAP_PRIOR_TARBALL: prior.tarball,
        SKILLMAP_TEST_TARBALL: candidate.tarball,
        SKILLMAP_UPGRADE_ARTIFACTS: rollbackArtifacts,
        npm_config_ignore_scripts: 'true',
        npm_config_offline: 'true',
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        SKILLMAP_ENABLE_MACOS_CUSTODY: '0'
      },
      stdio: 'inherit'
    });
    const rollback = JSON.parse(readFileSync(path.join(rollbackArtifacts, 'upgrade-rollback.json'), 'utf8'));
    assert.equal(rollback.status, 'passed');
    assert.equal(rollback.priorTarball.sha256, prior.sha256);
    assert.equal(rollback.candidateTarball.sha256, candidate.sha256);

    // Exercise the same sequence while a newer credential-format fixture and
    // unrelated workspace files are present. No production Keychain path is
    // enabled or touched by this test.
    installGlobal(prefix, workspace.workspace, prior.tarball);
    const cli = globalCli(prefix);
    assert.equal(runCli(cli, ['--version'], workspace.workspace).trim(), prior.version);
    credentialTransitions.push({ stage: 'prior-install', ...assertPathPreserved(credentialBefore, snapshotPath(workspace.credential), 'credential after prior install') });
    installGlobal(prefix, workspace.workspace, candidate.tarball);
    assert.equal(runCli(cli, ['--version'], workspace.workspace).trim(), candidate.version);
    assertFilesPreserved(preserved);
    assert.equal(existsSync(workspace.credential), true, 'candidate update removed the newer credential fixture');
    credentialTransitions.push({ stage: 'candidate-update', ...assertPathPreserved(credentialBefore, snapshotPath(workspace.credential), 'credential after candidate update') });
    installGlobal(prefix, workspace.workspace, prior.tarball);
    assert.equal(runCli(cli, ['--version'], workspace.workspace).trim(), prior.version);
    assertFilesPreserved(preserved);
    assert.equal(existsSync(workspace.credential), true, 'downgrade removed the newer credential-format fixture');
    credentialTransitions.push({ stage: 'prior-downgrade', ...assertPathPreserved(credentialBefore, snapshotPath(workspace.credential), 'credential after downgrade') });
    installGlobal(prefix, workspace.workspace, candidate.tarball);
    assert.equal(runCli(cli, ['--version'], workspace.workspace).trim(), candidate.version);
    assertFilesPreserved(preserved);
    assert.equal(existsSync(workspace.credential), true, 're-update removed the newer credential-format fixture');
    credentialTransitions.push({ stage: 'candidate-reupdate', ...assertPathPreserved(credentialBefore, snapshotPath(workspace.credential), 'credential after re-update') });

    // The supported removal order is explicit: logout first, then hook/config
    // uninstall, then npm uninstall. Runtime/cache fixture cleanup is scoped
    // to SkillMap-owned paths only.
    const sequence = [];
    const logout = await logoutCommand(workspace.workspace, {}, { useCase: mockLocalLogout(workspace.credential) });
    sequence.push('logout');
    assert.equal(logout.localDeleted, true);
    const hookResult = JSON.parse(runCli(cli, [
      'hook', 'uninstall', 'codex', '--config', workspace.hooks, '--json'
    ], workspace.workspace));
    sequence.push('hook/config-uninstall');
    assert.equal(hookResult.action, 'uninstall');
    const hooksAfter = JSON.parse(readFileSync(workspace.hooks, 'utf8'));
    assert.equal(JSON.stringify(hooksAfter).includes('skillmap route --hook'), false, 'SkillMap hook remained installed');
    assert.equal(JSON.stringify(hooksAfter).includes('other-tool prompt-hook'), true, 'unrelated hook was removed');
    removeOwnedFixtures(workspace);
    assertFilesPreserved(preserved);
    sequence.push('npm-uninstall');
    uninstallGlobal(prefix, workspace.workspace);
    assert.equal(existsSync(cli), false, 'npm uninstall did not remove the global SkillMap entrypoint');
    assert.deepEqual(sequence, ['logout', 'hook/config-uninstall', 'npm-uninstall']);
    assertFilesPreserved(preserved);

    const receipt = {
      schemaVersion: 1,
      kind: 'skillmap.m3-13.package-lifecycle',
      status: 'passed',
      packages: [
        packageReceipt(prior),
        packageReceipt(candidate)
      ],
      sequence,
      consumerReceipts,
      rollbackReceipt: path.join(rollbackArtifacts, 'upgrade-rollback.json'),
      lifecycleScripts: { observedIgnored: consumerReceipts.every(receipt => receipt.canaries.lifecycleMarkerExists === false) },
      credentialStorage: {
        mode: 'mocked-local-fixture',
        before: credentialBefore,
        transitions: credentialTransitions,
        newerFormatPreservedThroughDowngrade: credentialTransitions.every(entry => entry.sha256 === credentialBefore.sha256 && entry.mode === credentialBefore.mode),
        keychainAccessed: false
      },
      preservation: Object.fromEntries([...preservedDetails].map(([file, details]) => [file, details])),
      helper_signature_status: 'deferred_not_present',
      network: 'offline-local-tarballs-only'
    };
    writeFileSync(path.join(artifactRoot, 'm3-13-package-lifecycle.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8', { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    const cleanup = {
      schemaVersion: 1,
      kind: 'skillmap.m3-13.cleanup',
      status: 'cleaned',
      scratchRemoved: !existsSync(scratch),
      childProcessesSynchronous: true,
      artifactsRetained: existsSync(artifactRoot),
      artifactRoot
    };
    writeFileSync(path.join(artifactRoot, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`, 'utf8', { mode: 0o600 });
  }
});

function packageReceipt(packageInfo) {
  return {
    version: packageInfo.version,
    tarball: packageInfo.tarball,
    sha256: packageInfo.sha256,
    bytes: packageInfo.bytes,
    packManifest: {
      path: packageInfo.packManifestPath,
      sha256: packageInfo.packManifestSha256,
      files: packageInfo.manifest.files
    },
    sha256Sums: {
      path: packageInfo.digestEvidencePath,
      value: readFileSync(packageInfo.digestEvidencePath, 'utf8')
    },
    archiveEntries: packageInfo.archiveEntries
  };
}
