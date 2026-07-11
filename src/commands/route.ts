import { flagString, hasFlag } from '../core/args.js';
import { createRouteEvent, recordRouteEvent } from '../core/route-events.js';
import { executeRouteUseCase } from '../services/route-use-case.js';
import { openApprovedRoutingState } from '../services/workspace-read-model.js';
import type { EffectiveRegistry, RouteResultV2 } from '../schemas/types.js';

export async function routeCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const hookMode = hasFlag(flags, 'hook');
  const prompt = await resolvePrompt(positionals, flags, hookMode);
  const qualifiedSkillId = flagString(flags, 'skill-id');
  if (!prompt.trim() && !qualifiedSkillId) throw new Error('route requires a prompt or --skill-id.');
  const state = await openApprovedRoutingState(cwd);
  const { result, currentRevision } = executeRouteUseCase(state, {
    prompt,
    max: Number(flagString(flags, 'max') ?? '3'),
    ...(qualifiedSkillId ? { qualifiedSkillId } : {})
  });
  const surface = hookMode ? 'hook' : 'cli';
  await recordRouteEvent(cwd, createRouteEvent(result, currentRevision, surface));
  if (hookMode) {
    const hookText = result.decision.recommendations.length === 0 ? '' : result.decision.hookText;
    if (hasFlag(flags, 'json')) return { hookText, result };
    return { hookText };
  }
  if (hasFlag(flags, 'trace')) {
    return { result, statusWarnings: result.decision.warningCodes, trace: renderTrace(result) };
  }
  return result;
}

export async function loadEffective(cwd: string): Promise<EffectiveRegistry> {
  return (await openApprovedRoutingState(cwd)).effective;
}

async function resolvePrompt(positionals: string[], flags: Record<string, string | boolean | string[]>, hookMode: boolean): Promise<string> {
  const explicit = flagString(flags, 'prompt') ?? positionals.join(' ');
  if (explicit.trim() || !hookMode) return explicit;
  const stdin = await readStdinIfAvailable();
  if (!stdin.trim()) return '';
  try {
    const input = JSON.parse(stdin) as { prompt?: unknown };
    return typeof input.prompt === 'string' ? input.prompt : '';
  } catch {
    return stdin;
  }
}

async function readStdinIfAvailable(): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    const timeout = setTimeout(() => finish(new Error('Hook stdin did not finish within 1500ms.')), 1_500);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      if (error) reject(error); else resolve(data);
    };
    const onData = (chunk: string) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > 32 * 1024) return finish(new Error('Hook stdin exceeds the 32768-byte limit.'));
      data += chunk;
    };
    const onEnd = () => finish();
    const onError = (error: Error) => finish(error);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
  });
}

function renderTrace(result: RouteResultV2): string {
  const lines = [`SkillMap route trace ${result.routeId}`, `Revision: ${result.decision.revision.revisionId} (${result.decision.servingMode})`, '', 'Recommendations:'];
  for (const rec of result.decision.recommendations) {
    lines.push(`- ${rec.displayName} [score=${rec.score}, tier=${rec.tier}, skillId=${rec.skillId}]`);
    for (const reason of rec.reasonCodes.slice(0, 6)) lines.push(`  - ${reason}`);
  }
  if (result.decision.exclusions.length) {
    lines.push('', 'Exclusions:');
    for (const exclusion of result.decision.exclusions.slice(0, 8)) lines.push(`- ${exclusion.displayName}: ${exclusion.reasonCode}`);
  }
  if (result.decision.warningCodes.length) {
    lines.push('', 'State warnings:');
    for (const warning of result.decision.warningCodes.slice(0, 6)) lines.push(`- ${warning}`);
  }
  lines.push('', result.decision.hookText);
  return lines.join('\n');
}
