import { flagString, hasFlag } from '../core/args.js';

export async function hookCommand(_cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const action = positionals[0];
  const host = positionals[1];
  const prompt = flagString(flags, 'prompt') ?? positionals.slice(2).join(' ');
  if (action === 'dry-run' && host === 'codex') {
    return { host, action, note: 'Hook installation is intentionally out of Slice 1. Dry-run command placeholder only.', prompt };
  }
  if (action === 'install' && host === 'codex') {
    return { host, action, dryRun: hasFlag(flags, 'dry-run'), blocked: true, reason: 'Codex hook install is out of Slice 1. Prove route quality first.' };
  }
  throw new Error('Supported hook commands in Slice 1: hook dry-run codex, hook install codex --dry-run');
}
