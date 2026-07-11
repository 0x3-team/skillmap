import { escapeHtml, humanize } from './render.js';
import { clearPendingJobKey, pendingJobKey } from './state.js';

export function createJobActions(ctx) {
  function bindJobActions(scope = document) {
    for (const button of scope.querySelectorAll('.job-action')) button.addEventListener('click', () => submitJob(button.dataset.job, button));
  }

  async function submitJob(type, button) {
    if (!ctx.state.connected) return ctx.toast('Reconnect before starting a maintenance job.');
    const current = ctx.currentRevisionId();
    if (!current) return ctx.toast('No current revision is available for this job.');
    const parameters = jobParameters(type);
    const jobKeySlot = `${type}:${current}`;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = type === 'apply-policy' ? 'Applying…' : 'Queueing…';
    try {
      if (type === 'apply-policy') {
        const data = await ctx.api('/api/v1/policy/apply', { body: { expectedRevision: current, confirmation: 'review' } });
        ctx.toast(data.routingApproved ? 'Reviewed policy applied and approved for routing.' : 'Policy applied, but routing approval did not advance.');
        ctx.invalidate();
        await ctx.refreshWorkspaceState(false);
        return;
      }
      const data = await ctx.api('/api/v1/jobs', { body: {
        kind: 'skillmap.job-request', schemaVersion: 1, expectedRevision: current,
        idempotencyKey: pendingJobKey(jobKeySlot, type), requestedBy: 'api', confirmation: 'none', parameters
      } });
      ctx.toast(`Job ${data.job.jobId.slice(0, 8)} queued. Check Activity for completion.`);
      void pollJob(data.job.jobId, jobKeySlot);
    } catch (error) {
      ctx.toast(error.safeMessage || 'The maintenance job was not accepted.');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function pollJob(jobId, jobKeySlot) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const job = await ctx.api(`/api/v1/jobs/${jobId}`, { cache: false });
        if (['succeeded', 'failed', 'cancelled'].includes(job.state)) {
          clearPendingJobKey(jobKeySlot);
          ctx.toast(job.state === 'succeeded' ? `${humanize(job.type)} completed with a revision receipt.` : `${humanize(job.type)} ${job.state}. Review Activity.`);
          ctx.invalidate();
          await ctx.refreshWorkspaceState(false);
          return;
        }
      } catch (error) {
        if (error.code === 'CONNECTOR_OFFLINE') return;
      }
    }
    ctx.toast('The job is still running. Its durable receipt remains available in Activity.');
  }

  return { bindJobActions, submitJob };
}

export function actionButton(action) {
  const job = jobFromAction(action);
  return job
    ? `<button class="quiet-button job-action" type="button" data-job="${job}">${escapeHtml(action)}</button>`
    : `<span class="quiet-button" aria-disabled="true" title="Run this network check explicitly in the foreground CLI">${escapeHtml(action)} · CLI</span>`;
}

function jobFromAction(action) {
  const jobs = {
    'skillmap scan': 'scan', 'skillmap doctor': 'doctor', 'skillmap doctor-pack --summary': 'doctor-pack',
    'skillmap graph build': 'graph-build', 'skillmap sources check': 'sources-check',
    'skillmap eval --file .skillmap/real-evals.json --min-count 150 --min-top1 0.80 --min-top3 0.92 --max-avoid-hits 0 --save-report': 'eval-run'
  };
  return jobs[String(action).trim()] || null;
}

function jobParameters(type) {
  if (type === 'doctor-pack') return { type, summary: true };
  if (type === 'graph-build') return { type, mode: 'effective' };
  return { type };
}
