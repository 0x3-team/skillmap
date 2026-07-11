import { createPolicyProposal, decidePolicyProposal } from '../policy-actions.js';
import { escapeHtml, metric, pageHead, pill, revisionLine, shortDigest } from '../render.js';

export async function renderPolicies(ctx) {
  const data = await ctx.api('/api/v1/policy/reviews');
  const items = data.items || [];
  const duplicateCount = items.filter(item => item.queue === 'duplicate').length;
  const unmatchedCount = items.filter(item => item.queue === 'unmatched').length;
  const uncoveredCount = items.filter(item => item.queue === 'uncovered').length;
  const actionable = Number.isSafeInteger(data.actionable) ? data.actionable : items.filter(item => item.state === 'needs-review').length;
  const blocking = Number.isSafeInteger(data.blocking) ? data.blocking : items.filter(item => item.blocking).length;
  ctx.mount(`${pageHead('Policies', 'Compare unresolved variants, calculate real revision-bound impact, record decisions, then explicitly apply the reviewed policy.', `<button class="button job-action" type="button" data-job="apply-policy" ${ctx.state.connected ? '' : 'disabled'}>Apply reviewed policy</button>`)}
    ${revisionLine(data.revision || ctx.state.dashboard?.revision, ctx.state.dashboard?.servingMode)}
    <section class="metrics compact-metrics" aria-label="Policy review summary">${metric('Actionable', actionable, `${blocking} blocking`)}${metric('Duplicate sets', duplicateCount, 'Variant comparison')}${metric('Uncovered', uncoveredCount, 'Missing exact policy')}${metric('Unmatched', unmatchedCount, 'Stale policy mapping')}</section>
    <div class="policy-impact-grid">
      <section class="panel"><div class="panel-head"><h2>Before</h2><span>Current revision</span></div><div class="panel-body"><p>The serving revision remains unchanged while a proposal is reviewed.</p><ul class="stack-list"><li><span>Actionable queue</span><small>${actionable}</small></li><li><span>Blocking queue</span><small>${blocking}</small></li><li><span>Policy schema</span><small>v${escapeHtml(data.policyVersion || 'unknown')}</small></li><li><span>Routing approval</span><small>${ctx.state.dashboard?.routingReady ? 'Current serving revision approved' : 'Not ready'}</small></li></ul></div></section>
      <section class="panel"><div class="panel-head"><h2>Policy dry-run</h2><span>Real backend calculation</span></div><div class="panel-body"><p id="policy-impact-copy">Selecting a variant previews only the decision receipt. Run the revision-bound dry-run to calculate effective registry impact without publishing.</p><button id="policy-preview-button" class="button" type="button" ${ctx.state.connected ? '' : 'disabled'}>Run policy dry-run</button><div id="policy-preview-result" class="policy-preview-result" aria-live="polite"></div></div></section>
      <section class="panel"><div class="panel-head"><h2>After explicit apply</h2><span>Unknown until receipt</span></div><div class="panel-body"><p>A successful apply publishes a new immutable revision and reports whether routing approval advanced. No success is assumed in advance.</p></div></section>
    </div>
    <section class="panel spaced-panel"><div class="panel-head"><h2>Review queue</h2><span>${items.length} item${items.length === 1 ? '' : 's'}</span></div><div class="panel-body">${items.length ? `<div class="review-list">${items.map((item, index) => policyReviewItem(item, index, data.policyVersion === 2 && ctx.state.connected)).join('')}</div>` : '<div class="empty"><strong>No current policy review item</strong><span>The approved revision has no duplicate, unmatched, uncovered, explicit-only, or blocked entry.</span></div>'}</div></section>
    <div id="policy-compare" aria-live="polite"></div>`);
  ctx.jobs.bindJobActions();
  document.querySelector('#policy-preview-button')?.addEventListener('click', event => runPolicyPreview(ctx, event.currentTarget));
  const viewRoot = document.querySelector('#view-root');
  const handleProposalChange = event => {
    const form = event.target.closest?.('.policy-proposal');
    if (form && viewRoot.contains(form)) updatePolicyImpact(form);
  };
  const handleProposalSubmit = event => {
    const button = event.target.closest?.('.policy-proposal-submit');
    const form = button?.closest('.policy-proposal');
    if (form && viewRoot.contains(form)) void submitPolicyProposal(ctx, event, form);
  };
  viewRoot.addEventListener('input', handleProposalChange);
  viewRoot.addEventListener('click', handleProposalSubmit);
  ctx.onViewDispose(() => {
    viewRoot.removeEventListener('input', handleProposalChange);
    viewRoot.removeEventListener('click', handleProposalSubmit);
  });
  for (const button of document.querySelectorAll('.policy-compare')) button.addEventListener('click', () => comparePolicyVariants(ctx, items[Number(button.dataset.itemIndex)]));
}

function policyReviewItem(item, index, enabled) {
  const controls = proposalControls(item);
  const compare = item.queue === 'duplicate' && item.skillIds?.length
    ? `<button class="text-button policy-compare" type="button" data-item-index="${index}">Compare redacted metadata</button>`
    : '';
  return `<article class="review-item"><div><strong>${escapeHtml(item.displayName)}</strong><br>${pill(item.queue, item.blocking ? 'bad' : 'warn')} ${pill(item.state)} ${item.currentTier ? pill(item.currentTier) : ''}<br><small>${item.blocking ? 'Blocks policy readiness until accepted remediation.' : 'Configured policy state available for review.'}</small></div><div><form class="policy-proposal" data-review-id="${escapeHtml(item.reviewId)}" data-action="${escapeHtml(item.action)}" data-skill-id="${escapeHtml(item.skillIds?.[0] || '')}"><div class="policy-decision">${controls}<div class="field"><label>Review rationale<input name="reason" required minlength="12" maxlength="1000" placeholder="What was reviewed and why this action is appropriate" ${enabled ? '' : 'disabled'}></label></div><button class="button primary policy-proposal-submit" type="button" ${enabled ? '' : 'disabled'}>Review proposal</button></div></form>${enabled ? '' : '<p class="callout spaced-callout">Actionable decisions require an active policy v2 revision and a connected local capability.</p>'}${compare}<div class="policy-proposal-result" aria-live="polite"></div></div></article>`;
}

function proposalControls(item) {
  if (item.action === 'select-canonical') {
    return `<div class="field"><label>Canonical variant<select name="skillId">${item.skillIds.map(skillId => `<option value="${skillId}">${escapeHtml(skillId)}</option>`).join('')}</select></label></div>`;
  }
  if (item.action === 'set-skill-policy') {
    const tiers = ['active-default', 'specialist', 'explicit-only', 'archived', 'blocked'];
    return `<div class="field"><label>Reviewed tier<select name="tier">${tiers.map(tier => `<option value="${tier}" ${tier === (item.currentTier || 'specialist') ? 'selected' : ''}>${escapeHtml(tier)}</option>`).join('')}</select></label></div>`;
  }
  return '<div class="field"><label>Proposed action<input value="Retire stale unmatched entry" disabled></label></div>';
}

function updatePolicyImpact(form) {
  const values = new FormData(form);
  const selection = values.get('skillId') || values.get('tier') || form.dataset.action;
  document.querySelector('#policy-impact-copy').innerHTML = `Proposed review action: <code>${escapeHtml(selection)}</code>. Creating the proposal is read-only; accept, hold, or reject records a hash-bound decision revision without approving routing.`;
}

async function runPolicyPreview(ctx, button) {
  const target = document.querySelector('#policy-preview-result');
  const expectedRevision = ctx.currentRevisionId();
  if (!ctx.state.connected || !expectedRevision) {
    target.innerHTML = '<p class="callout spaced-callout">Reconnect to a current workspace revision before calculating policy impact.</p>';
    return;
  }
  button.disabled = true;
  button.textContent = 'Calculating…';
  target.innerHTML = '<div class="loading-view compact" role="status"><span class="spinner" aria-hidden="true"></span><span>Calculating policy impact against the current revision…</span></div>';
  try {
    const preview = await ctx.api('/api/v1/policy/preview', { body: { expectedRevision, confirmation: 'review' } });
    target.innerHTML = policyPreviewReceipt(preview);
    target.querySelector('h3')?.focus({ preventScroll: true });
  } catch (error) {
    target.innerHTML = `<p class="callout spaced-callout">${escapeHtml(error.safeMessage || 'Policy impact could not be calculated.')}</p>`;
  } finally {
    button.disabled = !ctx.state.connected;
    button.textContent = 'Run policy dry-run';
  }
}

function policyPreviewReceipt(preview) {
  const current = preview.currentSummary || {};
  const projected = preview.projectedSummary || {};
  const delta = preview.delta || {};
  const warnings = Array.isArray(preview.warnings) ? preview.warnings.slice(0, 20) : [];
  const currentLabel = preview.currentPresent === false ? 'No effective registry' : 'Current effective registry';
  return `<section class="policy-preview-receipt"><h3 tabindex="-1">Calculated impact</h3><p>${preview.currentPresent === false ? 'No effective registry is currently published; the zero current summary is an absence state.' : 'The current effective registry was compared with the reviewed policy.'} This result did not publish or approve routing.</p><div class="policy-summary-comparison"><article><span>${currentLabel}</span>${summaryValues(current)}</article><article><span>Projected registry</span>${summaryValues(projected)}</article><article><span>Delta</span>${summaryValues(delta, true)}</article></div><ul class="stack-list"><li><span>Routing approval eligible</span><small>${preview.routingApprovalEligible === true ? 'Yes, after separate apply' : 'No'}</small></li><li><span>Would publish</span><small>${preview.wouldPublish === false ? 'No' : 'Unexpected response'}</small></li><li><span>Revision</span><small><code>${escapeHtml(preview.revision?.revisionId || 'unavailable')}</code></small></li></ul>${warnings.length ? `<div class="callout spaced-callout"><strong>${warnings.length} warning${warnings.length === 1 ? '' : 's'}</strong><ul class="issue-list">${warnings.map(warning => `<li>${escapeHtml(String(warning))}</li>`).join('')}</ul></div>` : '<p class="callout good spaced-callout">The backend reported no dry-run warning.</p>'}</section>`;
}

function summaryValues(summary, signed = false) {
  return `<dl><div><dt>Skills</dt><dd>${signedNumber(summary.skills, signed)}</dd></div><div><dt>Route eligible</dt><dd>${signedNumber(summary.routeEligible, signed)}</dd></div><div><dt>Edges</dt><dd>${signedNumber(summary.edges, signed)}</dd></div></dl>`;
}

function signedNumber(value, signed) {
  const number = Number.isFinite(Number(value)) ? Number(value) : 0;
  return signed && number > 0 ? `+${number}` : String(number);
}

async function submitPolicyProposal(ctx, event, form) {
  event.preventDefault();
  if (!form) return;
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const target = form.parentElement.querySelector('.policy-proposal-result');
  const button = form.querySelector('.policy-proposal-submit');
  target.innerHTML = '<div class="loading-view compact" role="status"><span class="spinner" aria-hidden="true"></span><span>Binding proposal to the current revision…</span></div>';
  try {
    const proposal = await createPolicyProposal(ctx, {
      reviewId: form.dataset.reviewId,
      action: form.dataset.action,
      reason: values.get('reason'),
      ...(form.dataset.action === 'select-canonical' ? { skillId: values.get('skillId') } : {}),
      ...(form.dataset.action === 'set-skill-policy' ? { skillId: form.dataset.skillId, tier: values.get('tier') } : {})
    }, button);
    target.innerHTML = proposalReceipt(proposal);
    for (const decisionButton of target.querySelectorAll('[data-policy-decision]')) {
      decisionButton.addEventListener('click', () => decideProposal(ctx, proposal, decisionButton));
    }
    target.querySelector('h3')?.focus({ preventScroll: true });
  } catch (error) {
    target.innerHTML = `<p class="callout spaced-callout">${escapeHtml(error.safeMessage || 'The policy proposal could not be created.')}</p>`;
  }
}

function proposalReceipt(proposal) {
  return `<section class="policy-preview-receipt"><h3 tabindex="-1">Proposal ready for decision</h3><p>This proposal is bound to revision <code>${escapeHtml(proposal.expectedRevision)}</code> and expires ${escapeHtml(new Date(proposal.expiresAt).toLocaleString())}. It has not written or published state.</p><ul class="stack-list"><li><span>Action</span><small>${escapeHtml(proposal.action)}</small></li><li><span>Proposal digest</span><small><code>${shortDigest(proposal.proposalDigest)}</code></small></li><li><span>Would publish now</span><small>No</small></li></ul><div class="page-actions"><button class="button primary" type="button" data-policy-decision="accept">Accept</button><button class="button" type="button" data-policy-decision="hold">Hold</button><button class="quiet-button" type="button" data-policy-decision="reject">Reject</button></div></section>`;
}

async function decideProposal(ctx, proposal, button) {
  const target = button.closest('.policy-proposal-result');
  for (const candidate of target.querySelectorAll('[data-policy-decision]')) candidate.disabled = true;
  try {
    const receipt = await decidePolicyProposal(ctx, proposal, button.dataset.policyDecision, button);
    target.innerHTML = `<p class="callout good spaced-callout"><strong>${escapeHtml(receipt.decision)} recorded.</strong><br>Decision <code>${shortDigest(receipt.decisionDigest)}</code>; policy changed: ${receipt.policyChanged ? 'yes' : 'no'}; routing still requires explicit reviewed apply.</p>`;
  } catch (error) {
    target.innerHTML = `<p class="callout spaced-callout">${escapeHtml(error.safeMessage || 'The policy decision could not be recorded. Refresh and retry.')}</p>`;
  }
}

async function comparePolicyVariants(ctx, item) {
  if (!item?.skillIds?.length) return;
  const target = document.querySelector('#policy-compare');
  target.innerHTML = '<section class="panel spaced-panel"><div class="loading-view compact" role="status"><span class="spinner" aria-hidden="true"></span><span>Loading variant metadata…</span></div></section>';
  try {
    const details = await Promise.all(item.skillIds.map(skillId => ctx.api(`/api/v1/skills/${skillId}`)));
    target.innerHTML = `<section class="panel spaced-panel"><div class="panel-head"><h2>Compare ${escapeHtml(item.displayName)}</h2><span>${details.length} variants</span></div><div class="panel-body"><div class="variant-grid">${details.map(detail => `<article><h3>${escapeHtml(detail.displayName)}</h3><code>${detail.skillId}</code><p>${escapeHtml(detail.description || 'No redacted description')}</p><ul class="stack-list"><li><span>Tier</span><small>${escapeHtml(detail.tier)}</small></li><li><span>Route eligible</span><small>${detail.routeEligible ? 'Yes' : 'No'}</small></li><li><span>Scripts</span><small>${detail.scriptCount}</small></li><li><span>Revision</span><small><code>${shortDigest(detail.contentRevision)}</code></small></li></ul></article>`).join('')}</div></div></section>`;
    target.querySelector('h2')?.focus?.();
  } catch (error) {
    target.innerHTML = `<p class="callout spaced-panel">${escapeHtml(error.safeMessage || 'Variant metadata could not be compared.')}</p>`;
  }
}
