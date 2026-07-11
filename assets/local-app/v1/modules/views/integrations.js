import { escapeHtml, formatNumber, pageHead, revisionLine } from '../render.js';

const MCP_CONFIG = `[mcp_servers.skillmap]
command = "skillmap"
args = ["mcp", "serve"]
enabled_tools = ["route_prompt", "search_skills", "show_skill", "show_skillgraph", "doctor_summary", "source_status"]`;

const MCP_PREFLIGHT = `skillmap --version
skillmap mcp manifest --json
skillmap mcp call route_prompt --prompt "review this project's tests" --json`;

const HOOK_PREFLIGHT = `skillmap hook dry-run codex "review this project's tests"
skillmap hook install codex --passive --dry-run --json`;

const HOOK_INSTALL = 'skillmap hook install codex --passive --json';
const HOOK_UNINSTALL = `skillmap hook uninstall codex --dry-run --json
skillmap hook uninstall codex --json`;

export function renderIntegrations(ctx) {
  ctx.mount(`${pageHead('Integrations', 'Verify the read-only MCP server and passive project hook, then complete any installation manually from this project. The browser never edits Codex configuration or installs a hook.')}
    ${revisionLine(ctx.state.dashboard?.revision, ctx.state.dashboard?.servingMode)}
    <div class="section-grid">
      <section class="panel"><div class="panel-head"><h2>Codex MCP</h2><span>Project-local · read-only</span></div><div class="panel-body">
        <h3>1. Verify the server before configuring Codex</h3>
        <p>These checks use the current workspace and do not change Codex configuration. The route preflight records the same bounded, prompt-free audit event as a normal route; it does not change policy, revisions, or skill roots.</p>
        <button id="verify-mcp" class="button" type="button">Verify local manifest</button><div id="mcp-result" class="spaced-callout" aria-live="polite"></div>
        ${commandBlock(MCP_PREFLIGHT)}
        <hr class="divider">
        <h3>2. Install by merging one project-scoped table</h3>
        <p>From the project root, merge this table into <code>.codex/config.toml</code>. Preserve any existing settings; do not replace the whole file. Codex loads project configuration only after the project is trusted.</p>
        ${commandBlock(MCP_CONFIG)}
        <small class="help-text">This allowlist matches SkillMap's six read-only MCP tools. No write-capable MCP tool is exposed.</small>
        <hr class="divider">
        <h3>3. Restart Codex and verify</h3>
        <p>Restart Codex in this project, then run <code>codex mcp list</code>. The <code>skillmap</code> server should appear only while this trusted project configuration is in scope.</p>
        <h3 class="spaced-control">Uninstall or roll back</h3>
        <p>Remove only the <code>[mcp_servers.skillmap]</code> table from <code>.codex/config.toml</code>, restart Codex, and run <code>codex mcp list</code> again. If you made a byte-for-byte backup before editing, restoring that project file is the exact rollback. Neither action removes <code>.skillmap</code> or changes a skill root.</p>
      </div></section>
      <section class="panel"><div class="panel-head"><h2>Codex hook</h2><span>Project-local · passive</span></div><div class="panel-body">
        <h3>1. Verify routing and install preflight</h3>
        <p>Use a real task below for a loopback-only dry-run. The prompt is not stored and this browser action never installs a hook.</p>
        <form id="hook-verify"><div class="field"><label for="hook-prompt">Verification task</label><input id="hook-prompt" name="prompt" required maxlength="32768" autocomplete="off" placeholder="Describe a task for the passive hint"><small>The task is sent only to the loopback connector and is cleared from this form immediately.</small></div><div class="form-actions"><button class="button" type="submit">Verify dry-run</button></div></form><div id="hook-result" aria-live="polite"></div>
        ${commandBlock(HOOK_PREFLIGHT)}
        <hr class="divider">
        <h3>2. Install in this project</h3>
        <p>Only after the preflight reports ready, run this command from the project root. Its default target is <code>.codex/hooks.json</code>.</p>
        ${commandBlock(HOOK_INSTALL)}
        <p class="callout"><strong>Manual trust handoff required</strong><br>Open <code>/hooks</code> in Codex, inspect the new SkillMap <code>UserPromptSubmit</code> command and target, and trust it only if it matches the reviewed project-local definition. Until that review, do not treat the hook as active.</p>
        <small class="help-text">Global scope and force overrides are deliberately omitted from this workflow.</small>
        <hr class="divider">
        <h3>3. Uninstall and verify removal</h3>
        ${commandBlock(HOOK_UNINSTALL)}
        <p>Run the uninstall dry-run first, then the confirmed uninstall. Reopen <code>/hooks</code> and verify that only the SkillMap hook was removed. Existing hook files receive a timestamped <code>backupPath</code> in the command receipt; after stopping Codex, that exact file is the manual byte-for-byte rollback if needed.</p>
      </div></section>
    </div>
    <p class="microcopy">All terminal commands are operator handoffs. This page exposes only read-only manifest verification and a no-install hook dry-run through the bounded loopback API.</p>`);
  document.querySelector('#verify-mcp').addEventListener('click', event => verifyMcp(ctx, event));
  document.querySelector('#hook-verify').addEventListener('submit', event => verifyHook(ctx, event));
}

function commandBlock(value) {
  return `<pre class="code-block spaced-control"><code>${escapeHtml(value)}</code></pre>`;
}

async function verifyMcp(ctx, event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const manifest = await ctx.api('/api/v1/integrations/mcp');
    document.querySelector('#mcp-result').innerHTML = `<p class="callout good"><strong>Manifest verified locally</strong><br>${manifest.tools?.length || 0} bounded read-only tools · request limit ${formatNumber(manifest.limits?.requestBytes)} bytes · configuration changed false.</p>`;
  } catch (error) { ctx.toast(error.safeMessage || 'MCP verification failed.'); }
  finally { button.disabled = false; }
}

async function verifyHook(ctx, event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const input = form.querySelector('[name="prompt"]');
  const prompt = input.value;
  input.value = '';
  button.disabled = true;
  try {
    const result = await ctx.api('/api/v1/integrations/hook/verify', { body: { prompt } });
    document.querySelector('#hook-result').innerHTML = `<p class="callout ${result.readiness?.allowed ? 'good' : ''}"><strong>Dry-run ${result.readiness?.allowed ? 'ready' : 'blocked by readiness'}</strong><br>${escapeHtml(result.hookText || 'The deterministic router abstained.')}<br>promptStored ${String(result.promptStored)} · installPerformed ${String(result.installPerformed)}</p>`;
  } catch (error) { ctx.toast(error.safeMessage || 'Hook dry-run verification failed.'); }
  finally { button.disabled = false; }
}
