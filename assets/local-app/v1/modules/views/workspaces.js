import { escapeHtml, humanize, pageHead } from '../render.js';

export function renderWorkspaces(ctx) {
  const validation = ctx.state.workspaceValidation;
  const currentName = safeWorkspaceLabel(ctx.state.workspace?.name || ctx.state.dashboard?.workspace?.name, 'No initialized workspace');
  const currentState = ctx.state.bootstrap?.state || 'unknown';
  ctx.mount(`${pageHead('Workspaces', 'Choose the one local directory this foreground connector serves. Directory paths are used only for validation and are never written to browser storage or receipts.')}
    <div class="section-grid">
      <section class="panel"><div class="panel-head"><h2>Choose foreground workspace</h2><span>Two-step confirmation</span></div><div class="panel-body">
        ${validation ? '' : `<form id="workspace-form" autocomplete="off">
          <fieldset class="choice-group"><legend>Directory action</legend>
            <label class="choice-option"><input type="radio" name="mode" value="select-existing" checked><span><strong>Select existing</strong><small>Must already be a regular, non-symlink directory.</small></span></label>
            <label class="choice-option"><input type="radio" name="mode" value="create-new"><span><strong>Create new</strong><small>The connector creates only the exact new directory after validation and confirmation.</small></span></label>
          </fieldset>
          <div class="field spaced-field"><label for="workspace-candidate">Local directory</label><input id="workspace-candidate" name="candidate" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Enter an absolute directory path" required><small>The path is sent once to this loopback connector for bounded metadata validation. It is not retained by the browser.</small></div>
          <label id="create-workspace-ack" class="confirmation-check" hidden><input type="checkbox" name="createAcknowledged" value="yes"><span>I intend to create this new local directory.</span></label>
          <div class="form-actions"><button class="button primary" type="submit" ${ctx.state.connected ? '' : 'disabled'}>Validate directory</button></div>
        </form>`}
        <div id="workspace-validation" aria-live="polite">${validation ? workspaceValidationReceipt(validation) : ''}</div>
      </div></section>
      <aside class="panel"><div class="panel-head"><h2>Current connector scope</h2><span>Foreground only</span></div><div class="panel-body"><ul class="stack-list">
        <li><span>Workspace</span><small>${escapeHtml(currentName)}</small></li><li><span>State</span><small>${escapeHtml(humanize(currentState))}</small></li>
        <li><span>Directory receipt</span><small>Redacted label only</small></li><li><span>Cloud sync</span><small>Off</small></li>
      </ul><p class="callout">Switching clears cached workspace views, pending route output, and browser-scoped job keys before the new workspace is loaded.</p></div></aside>
    </div>`);
  const form = document.querySelector('#workspace-form');
  if (form) {
    form.addEventListener('submit', event => validateWorkspaceSelection(ctx, event));
    for (const control of form.querySelectorAll('[name="mode"]')) control.addEventListener('change', syncWorkspaceMode);
    syncWorkspaceMode();
  }
  document.querySelector('#confirm-workspace')?.addEventListener('click', event => selectValidatedWorkspace(ctx, event));
  document.querySelector('#cancel-workspace-validation')?.addEventListener('click', () => {
    ctx.state.workspaceValidation = null;
    renderWorkspaces(ctx);
    document.querySelector('#workspace-candidate')?.focus();
  });
}

function syncWorkspaceMode() {
  const form = document.querySelector('#workspace-form');
  if (!form) return;
  const createNew = new FormData(form).get('mode') === 'create-new';
  const acknowledgment = document.querySelector('#create-workspace-ack');
  acknowledgment.hidden = !createNew;
  const checkbox = acknowledgment.querySelector('input');
  checkbox.required = createNew;
  if (!createNew) checkbox.checked = false;
}

function workspaceValidationReceipt(validation) {
  const action = validation.mode === 'create-new' ? 'Create and use workspace' : 'Use this workspace';
  return `<div class="callout good spaced-callout workspace-confirmation"><strong>${escapeHtml(validation.label)}</strong><br>${escapeHtml(humanize(validation.state))}. Confirm using this redacted validation receipt; the directory path is no longer held by the page.<div class="form-actions"><button id="confirm-workspace" class="button primary" type="button">${action}</button><button id="cancel-workspace-validation" class="quiet-button" type="button">Cancel</button></div></div>`;
}

async function validateWorkspaceSelection(ctx, event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const mode = values.get('mode');
  const candidate = String(values.get('candidate') || '').trim();
  const output = document.querySelector('#workspace-validation');
  const button = form.querySelector('[type="submit"]');
  if (mode === 'create-new' && values.get('createAcknowledged') !== 'yes') {
    output.innerHTML = '<p class="callout">Explicitly confirm that this is a new directory before validation.</p>';
    return;
  }
  if (!candidate) return;
  form.querySelector('#workspace-candidate').value = '';
  ctx.state.workspaceValidation = null;
  button.disabled = true;
  button.textContent = 'Validating…';
  output.innerHTML = '<p class="subtle">Validating bounded directory metadata…</p>';
  try {
    const response = await ctx.api('/api/v1/workspaces/validate', { body: { candidate, mode } });
    if (!response?.validationId) throw { code: 'INVALID_VALIDATION_RECEIPT', safeMessage: 'The connector returned an invalid workspace validation receipt.' };
    ctx.state.workspaceValidation = {
      validationId: String(response.validationId), label: safeWorkspaceLabel(response.label, 'Validated workspace'),
      state: safeWorkspaceState(response.state, mode === 'create-new' ? 'ready-to-create' : 'ready-to-select'), mode
    };
    renderWorkspaces(ctx);
    document.querySelector('#confirm-workspace')?.focus();
  } catch (error) {
    output.innerHTML = `<p class="callout">${escapeHtml(safeWorkspaceError(error, 'The directory could not be validated. Confirm it is an absolute regular non-symlink directory and try again.'))}</p>`;
  } finally {
    button.disabled = !ctx.state.connected;
    button.textContent = 'Validate directory';
  }
}

async function selectValidatedWorkspace(ctx, event) {
  const validation = ctx.state.workspaceValidation;
  if (!validation) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = validation.mode === 'create-new' ? 'Creating…' : 'Switching…';
  try {
    const receipt = await ctx.api('/api/v1/workspaces/select', { body: { validationId: validation.validationId, confirm: true } });
    const redactedLabel = safeWorkspaceLabel(receipt?.label || validation.label, 'selected workspace');
    ctx.clearClientWorkspaceState();
    history.replaceState({}, '', '/app');
    await ctx.boot(true);
    if (!ctx.state.bootstrap) return;
    const destination = ctx.bootstrapNeedsOnboarding(ctx.state.bootstrap) ? 'onboarding' : 'overview';
    const workspaceId = ctx.activeWorkspaceId();
    history.replaceState({}, '', workspaceId && destination !== 'onboarding' ? `/app/${workspaceId}/${destination}` : `/app/${destination}`);
    await ctx.renderRoute(destination);
    ctx.toast(`Foreground workspace changed to ${redactedLabel}.`);
  } catch (error) {
    if (workspaceSelectionOutcomeUnknown(error)) {
      ctx.clearClientWorkspaceState();
      history.replaceState({}, '', '/app');
      await ctx.boot(true);
      if (ctx.state.bootstrap) ctx.toast('The selection response was unavailable. The connector’s active workspace was reloaded before showing any workspace data.');
      return;
    }
    const message = safeWorkspaceError(error, 'The workspace was not changed. Validate it again and retry.');
    if (['WORKSPACE_VALIDATION_INVALID', 'WORKSPACE_VALIDATION_CHANGED', 'WORKSPACE_CREATE_FAILED', 'WORKSPACE_FRESHNESS_START_FAILED', 'WORKSPACE_FRESHNESS_STOP_FAILED'].includes(error?.code)) {
      ctx.state.workspaceValidation = null;
      renderWorkspaces(ctx);
      ctx.toast(message);
      document.querySelector('#workspace-candidate')?.focus();
      return;
    }
    ctx.toast(message);
    button.disabled = false;
    button.textContent = validation.mode === 'create-new' ? 'Create and use workspace' : 'Use this workspace';
  }
}

function safeWorkspaceLabel(value, fallback) {
  const label = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return label && label.length <= 96 && !/[\\/]/.test(label) && !/^file:/i.test(label) ? label : fallback;
}
function safeWorkspaceState(value, fallback) { const code = String(value || '').trim().toLowerCase(); return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(code) ? code : fallback; }
function safeWorkspaceError(error, fallback) {
  if (['WORKSPACE_VALIDATION_INVALID', 'WORKSPACE_VALIDATION_CHANGED'].includes(error?.code)) return 'Workspace validation changed or expired. Validate the directory again.';
  if (error?.code === 'WORKSPACE_SWITCH_JOBS_ACTIVE') return 'A workspace has a queued or running job. Finish or cancel it before switching.';
  const message = String(error?.safeMessage || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return message && message.length <= 240 && !/[\\/]/.test(message) && !/\bfile:/i.test(message) ? message : fallback;
}
function workspaceSelectionOutcomeUnknown(error) { return error?.code === 'CONNECTOR_OFFLINE' || error?.code === 'MALFORMED_RESPONSE' || !Number.isInteger(error?.status) || error.status >= 500; }
