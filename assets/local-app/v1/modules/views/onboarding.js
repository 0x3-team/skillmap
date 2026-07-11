import { escapeHtml, humanize, pageHead, pill } from '../render.js';

const CURATION_PREPARE_COMMAND = 'skillmap curate codex --prepare';
const CURATION_DRY_RUN_COMMAND = 'skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model MODEL --dry-run';
const CURATION_INGEST_COMMAND = 'skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model MODEL --confirm';

export function renderOnboarding(ctx) {
  const bootstrap = ctx.state.bootstrap || {};
  const initialized = Boolean(bootstrap.initialized);
  const migrationRequired = bootstrap.state === 'needs-state-migration';
  const recoveryRequired = bootstrap.state === 'recovery-required';
  const partialLegacy = bootstrap.state === 'partial-legacy';
  const manualRepairRequired = bootstrap.state === 'manual-repair-required';
  const partialHasRoots = Number(bootstrap.configuredRootCount || 0) > 0;
  const rootForm = `<form id="root-form" autocomplete="off"><div class="field"><label for="root-candidate">Skill directory</label><input id="root-candidate" name="candidate" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Enter an absolute skill directory" required><small>The connector validates directory metadata first. It does not adopt this path until the second confirmation.</small></div><div class="form-actions"><button class="button primary" type="submit" ${ctx.state.connected ? '' : 'disabled'}>Validate scope</button></div></form><div id="root-validation" aria-live="polite"></div>`;
  const onboardingContent = migrationRequired
    ? `<div class="empty"><strong>Explicit state migration required</strong><p>Existing SkillMap identity or inventory files were found. Review the local <code>.skillmap</code> files before continuing. Migration snapshots them into an immutable revision and does not approve routing.</p><button id="migrate-state" class="button primary" type="button">I reviewed the files — migrate state</button><small>CLI equivalent: <code>skillmap state migrate --confirm</code></small></div>`
    : recoveryRequired
      ? `<div class="empty"><strong>Derived-state recovery is available</strong><p>The current revision has derived-only corruption and an eligible last-known-good revision validated. Review <code>skillmap state status --json</code> first.</p><button id="recover-state" class="button primary" type="button">I reviewed diagnostics — recover LKG</button></div>`
      : manualRepairRequired
        ? `<div class="empty"><strong>Manual state repair required</strong><p>${escapeHtml(bootstrap.guidance || 'Run skillmap state status --json. Marker, pointer, manifest, canonical, and raw-state faults cannot use automatic LKG recovery.')}</p><small>Diagnostic code: <code>${escapeHtml(bootstrap.errorCode || 'STATE_UNAVAILABLE')}</code></small></div>`
        : partialLegacy
          ? partialHasRoots
            ? `<div class="empty"><strong>Config-only legacy workspace</strong><p>A legacy config names ${Number(bootstrap.configuredRootCount)} root(s), but no workspace identity or inventory exists. Review the config, then explicitly validate and adopt every configured root.</p><button id="adopt-partial-legacy" class="button primary" type="button">Validate and adopt configured roots</button><small>This creates an identity and an unapproved immutable revision; it does not scan or enable routing.</small></div>`
            : `<div class="empty"><strong>Config-only legacy workspace</strong><p>The legacy config has no roots. Validate and approve one root to create the workspace identity safely.</p></div>${rootForm}`
          : initialized ? onboardingChecklist(ctx) : rootForm;
  ctx.mount(`${pageHead('Set up this local workspace', initialized ? 'Continue through the evidence gates in order. You can stop safely between steps.' : 'Approve the exact directory SkillMap may scan. Nothing is mutated until you confirm.', '<button class="quiet-button" type="button" data-route="workspaces">Stop safely</button><button class="quiet-button" type="button" data-route="trust">Review trust boundary</button>')}
    ${initialized ? progressSummary(ctx) : ''}
    <div class="section-grid">
      <section class="panel"><div class="panel-head"><h2>${initialized ? 'Resume checklist' : 'Approve a skill root'}</h2><span>${initialized ? 'Revisioned' : 'Step 1 of 10'}</span></div><div class="panel-body">${onboardingContent}</div></section>
      <aside class="panel"><div class="panel-head"><h2>Trust boundary</h2><span>Local only</span></div><div class="panel-body"><ul class="stack-list"><li><span>Network</span><small>127.0.0.1 only</small></li><li><span>Prompt retention</span><small>Off</small></li><li><span>Skill scripts</span><small>Never executed by scan</small></li><li><span>Global hook</span><small>Never automatic</small></li></ul><hr class="divider"><button class="quiet-button" type="button" data-route="settings">Review revision history</button><small class="help-text">Rollback creates a new unapproved revision. Routing may remain on a verified safety-equivalent LKG; otherwise it abstains until explicit approval.</small></div></aside>
    </div>`);
  document.querySelector('#root-form')?.addEventListener('submit', event => validateRoot(ctx, event));
  document.querySelector('#migrate-state')?.addEventListener('click', event => runStateAction(ctx, '/api/v1/state/migrate', event.currentTarget, 'Workspace state migrated. Continue onboarding.'));
  document.querySelector('#recover-state')?.addEventListener('click', event => runStateAction(ctx, '/api/v1/state/recover', event.currentTarget, 'Last-known-good state recovered as a new revision.'));
  document.querySelector('#adopt-partial-legacy')?.addEventListener('click', event => runStateAction(ctx, '/api/v1/state/adopt-partial-legacy', event.currentTarget, 'Configured roots adopted into an unapproved workspace revision. Continue with scan.'));
  for (const button of document.querySelectorAll('[data-copy-curation]')) button.addEventListener('click', () => copyCurationCommand(ctx, button));
  ctx.jobs.bindJobActions();
}

function onboardingChecklist(ctx) {
  const evidence = onboardingEvidence(ctx);
  const steps = [
    ['Scan approved roots', 'scan', evidence.scanned], ['Run structural doctor', 'doctor', evidence.doctor], ['Create compact doctor pack', 'doctor-pack', evidence.doctorPack],
    ['Review native-agent curation', 'curation', evidence.curation], ['Review, preview, and apply policy', 'policies', evidence.policy], ['Build the approved SkillGraph', 'graph-build', evidence.graph],
    ['Classify and review sources', 'sources', evidence.sources], ['Label, import, and run a credible eval suite', 'evals', evidence.eval], ['Verify first route', 'route', evidence.route]
  ];
  return `<ol class="stack-list onboarding-steps">${steps.map(([label, action, complete], index) => `<li><span><strong>${index + 1}. ${escapeHtml(label)}</strong><br><small>${complete ? 'Evidence recorded for the current readiness state' : action === 'curation' ? 'Native-agent review remains outside browser authority' : 'Requires an explicit reviewed action'}</small></span><span class="step-action">${complete ? pill('recorded', 'good') : ['policies', 'sources', 'evals', 'route'].includes(action) ? `<button class="quiet-button" type="button" data-route="${action}">Open</button>` : action === 'curation' ? '<a class="quiet-button" href="#curation-handoff">Review handoff</a>' : `<button class="quiet-button job-action" type="button" data-job="${action}">Run</button>`}</span></li>`).join('')}</ol>${curationHandoff(evidence.curation)}<p class="callout">Native-agent curation and credible holdout labeling remain human review steps. The browser will not execute an agent, ingest a proposal, or manufacture release evidence.</p><div class="onboarding-optional"><strong>Optional after the first trusted route</strong><button class="quiet-button" type="button" data-route="integrations">Verify MCP and passive hook dry-run</button></div>`;
}

function curationHandoff(complete) {
  return `<section id="curation-handoff" class="curation-handoff" aria-labelledby="curation-heading"><div class="panel-head"><div><h3 id="curation-heading">Native-agent curation handoff</h3><span>${complete ? 'Current readiness evidence recorded' : 'Explicit external review required'}</span></div>${pill(complete ? 'recorded' : 'incomplete', complete ? 'good' : 'warn')}</div><div class="panel-body"><p>SkillMap prepares bounded local artifacts; it does not send them anywhere. <strong>You choose the model, the native agent, and exactly what leaves this machine.</strong> Review <code>docs/curation.md</code> before continuing.</p><div class="curation-command"><div><strong>1. Prepare local curation inputs</strong><pre class="code-block"><code>${CURATION_PREPARE_COMMAND}</code></pre></div><button class="quiet-button" type="button" data-copy-curation="prepare">Copy prepare command</button></div><div class="curation-command"><div><strong>2. Review the returned files with a dry-run</strong><pre class="code-block"><code>${CURATION_DRY_RUN_COMMAND}</code></pre></div><button class="quiet-button" type="button" data-copy-curation="dry-run">Copy dry-run command</button></div><div class="curation-command"><div><strong>3. Confirm only after reviewing the dry-run</strong><pre class="code-block"><code>${CURATION_INGEST_COMMAND}</code></pre></div><button class="quiet-button" type="button" data-copy-curation="ingest">Copy confirm command</button></div><p class="microcopy">Replace <code>MODEL</code> yourself. Confirmed ingest is revisioned, but it does not silently approve a global hook or bypass policy review.</p><div class="form-actions"><button class="quiet-button" type="button" data-route="workspaces">Stop safely</button><button class="quiet-button" type="button" data-route="trust">Review trust boundary</button><button class="quiet-button" type="button" data-route="settings">Review rollback history</button></div></div></section>`;
}

function progressSummary(ctx) {
  const evidence = onboardingEvidence(ctx);
  const completed = Object.values(evidence).filter(Boolean).length;
  return `<section class="progress-panel" aria-label="Onboarding progress"><div><strong>${completed} of 10 evidence gates observed</strong><span>Current API evidence only; doctor, doctor-pack, curation, graph, and source completion are never inferred from a clicked button.</span></div><progress value="${completed}" max="10">${completed}/10</progress></section>`;
}

function onboardingEvidence(ctx) {
  const dashboardEvidence = ctx.state.dashboard?.evidence || {};
  const readiness = ctx.state.dashboard?.readiness || {};
  const readinessPhase = String(readiness.phase || '').toLowerCase();
  const nextActions = Array.isArray(readiness.nextActions) ? readiness.nextActions.map(action => String(action).toLowerCase()) : [];
  const curationRequired = /(?:needs|stale)[-_ ]curation/.test(readinessPhase) || nextActions.some(action => /curat/.test(action));
  const readinessOrder = ['needs-state-migration', 'state-corrupt', 'missing-inventory', 'needs-config', 'empty-inventory', 'identity-invalid', 'fixture-inventory', 'needs-doctor', 'needs-doctor-pack', 'needs-policy', 'needs-duplicate-resolution', 'needs-curation', 'stale-curation', 'needs-effective', 'stale-effective', 'needs-graph', 'needs-sources', 'needs-source-review', 'needs-eval', 'eval-fixture', 'eval-failing', 'needs-routing-approval', 'ready'];
  const phaseIndex = readinessOrder.indexOf(readinessPhase);
  return {
    roots: (ctx.state.workspace?.roots?.length || 0) > 0,
    scanned: (dashboardEvidence.inventorySkills || 0) > 0,
    doctor: dashboardEvidence.doctorPresent === true,
    doctorPack: dashboardEvidence.doctorPackPresent === true,
    curation: dashboardEvidence.curationPresent === true && dashboardEvidence.curationStale !== true && !curationRequired,
    policy: phaseIndex >= readinessOrder.indexOf('needs-graph') && Boolean(ctx.state.dashboard?.currentRevision?.effectiveRevisionDigest || ctx.state.dashboard?.currentRevision?.effectiveDigest),
    graph: phaseIndex > readinessOrder.indexOf('needs-graph'),
    sources: phaseIndex > readinessOrder.indexOf('needs-source-review'),
    eval: dashboardEvidence.releaseEvidenceEligible === true && (ctx.state.dashboard?.counts?.evalCases || 0) > 0,
    route: (dashboardEvidence.observedRoutes || 0) > 0
  };
}

async function copyCurationCommand(ctx, button) {
  const command = button.dataset.copyCuration === 'ingest' ? CURATION_INGEST_COMMAND : button.dataset.copyCuration === 'dry-run' ? CURATION_DRY_RUN_COMMAND : CURATION_PREPARE_COMMAND;
  try {
    await navigator.clipboard.writeText(command);
    ctx.toast('Curation command copied. Review it before running in your terminal.');
  } catch {
    ctx.toast('Clipboard access is unavailable. The exact command remains visible for manual copy.');
  }
}

async function validateRoot(ctx, event) {
  event.preventDefault();
  const form = event.currentTarget;
  const candidate = new FormData(form).get('candidate');
  const output = document.querySelector('#root-validation');
  form.querySelector('[name="candidate"]').value = '';
  output.innerHTML = '<p class="subtle">Validating directory metadata…</p>';
  try {
    const validation = await ctx.api('/api/v1/roots/validate', { body: { candidate } });
    output.innerHTML = `<div class="callout good spaced-callout"><strong>${escapeHtml(validation.label)}</strong> is a regular directory. <button id="approve-root" class="button primary" type="button">Approve this scope</button></div>`;
    document.querySelector('#approve-root').addEventListener('click', () => approveRoot(ctx, validation.validationId));
  } catch (error) {
    output.innerHTML = `<p class="callout">${escapeHtml(error.safeMessage || 'Root validation failed.')}</p>`;
  }
}

async function approveRoot(ctx, validationId) {
  try {
    await ctx.api('/api/v1/roots/approve', { body: { validationId, expectedRevision: ctx.currentRevisionId() } });
    ctx.toast('Root approved. Continue with scan and review.');
    await ctx.boot(true);
  } catch (error) { ctx.toast(error.safeMessage || 'Root approval failed.'); }
}

async function runStateAction(ctx, endpoint, button, successMessage) {
  button.disabled = true;
  try {
    await ctx.api(endpoint, { body: { confirm: true } });
    ctx.invalidate();
    ctx.toast(successMessage);
    await ctx.boot(true);
  } catch (error) { ctx.toast(error.safeMessage || 'The state operation could not be completed safely.'); }
  finally { button.disabled = false; }
}
