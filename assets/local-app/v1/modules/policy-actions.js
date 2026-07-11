export async function recordCanonicalDecision(ctx, { displayName, skillId, reason, button }) {
  if (!ctx.state.connected) return ctx.toast('Reconnect before recording a policy decision.');
  const expectedRevision = ctx.currentRevisionId();
  if (!expectedRevision) return ctx.toast('No current revision is available for this decision.');
  button.disabled = true;
  try {
    await ctx.api('/api/v1/policy/decisions', { body: { displayName, skillId, actor: 'local-operator', reason, expectedRevision } });
    ctx.invalidate();
    ctx.toast('Canonical decision recorded. Apply the reviewed policy to approve a new routing revision.');
    await ctx.refreshWorkspaceState(false);
  } catch (error) {
    ctx.toast(error.safeMessage || 'The policy decision was not recorded.');
  } finally {
    button.disabled = false;
  }
}

export async function createPolicyProposal(ctx, input, button) {
  if (!ctx.state.connected) throw Object.assign(new Error('Reconnect before creating a policy proposal.'), { safeMessage: 'Reconnect before creating a policy proposal.' });
  const expectedRevision = ctx.currentRevisionId();
  if (!expectedRevision) throw Object.assign(new Error('No current revision is available.'), { safeMessage: 'No current revision is available for this proposal.' });
  button.disabled = true;
  try {
    return await ctx.api('/api/v1/policy/proposals', {
      body: { ...input, actor: 'local-operator', expectedRevision }
    });
  } finally {
    button.disabled = false;
  }
}

export async function decidePolicyProposal(ctx, proposal, decision, button) {
  if (!ctx.state.connected) throw Object.assign(new Error('Reconnect before deciding a policy proposal.'), { safeMessage: 'Reconnect before deciding a policy proposal.' });
  const expectedRevision = ctx.currentRevisionId();
  if (!expectedRevision || expectedRevision !== proposal.expectedRevision) {
    throw Object.assign(new Error('The current revision changed.'), { safeMessage: 'The current revision changed. Refresh the policy queue and create a fresh proposal.' });
  }
  button.disabled = true;
  try {
    const receipt = await ctx.api('/api/v1/policy/decisions', {
      body: {
        proposalId: proposal.proposalId,
        proposalDigest: proposal.proposalDigest,
        decision,
        expectedRevision,
        confirmation: 'review'
      }
    });
    ctx.invalidate();
    ctx.toast(`${decision === 'accept' ? 'Accepted' : decision === 'hold' ? 'Held' : 'Rejected'} policy proposal recorded in a new revision.`);
    await ctx.refreshWorkspaceState(false);
    return receipt;
  } finally {
    button.disabled = false;
  }
}
