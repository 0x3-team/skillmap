import { chmod, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { routeCommand } from './route.js';

interface HooksFile {
  hooks?: Record<string, HookGroup[]>;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookHandler[];
}

interface HookHandler {
  type?: string;
  command?: string;
  timeout?: number;
  statusMessage?: string;
}

export async function hookCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const action = positionals[0];
  const host = positionals[1];
  if (host !== 'codex') throw new Error('Supported hook host: codex.');

  if (action === 'dry-run') return dryRunPrompt(cwd, positionals.slice(2), flags);
  if (action === 'install') return installCodexHook(cwd, flags);
  if (action === 'uninstall') return uninstallCodexHook(cwd, flags);
  throw new Error('Supported hook commands: hook dry-run codex <prompt>, hook install codex --passive [--dry-run], hook uninstall codex [--dry-run].');
}

async function dryRunPrompt(cwd: string, promptParts: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const prompt = flagString(flags, 'prompt') ?? promptParts.join(' ');
  if (!prompt.trim()) throw new Error('hook dry-run codex requires a prompt.');
  const result = await routeCommand(cwd, [], { ...flags, prompt, hook: true });
  const hookText = typeof result === 'object' && result !== null && 'hookText' in result ? String((result as { hookText?: string }).hookText ?? '') : '';
  return {
    host: 'codex',
    action: 'dry-run',
    prompt,
    hookText,
    summary: hookText || 'SkillMap hook dry-run: no confident recommendation.'
  };
}

async function installCodexHook(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  if (!hasFlag(flags, 'passive')) throw new Error('Codex hook install requires --passive. SkillMap only installs passive route hints.');
  const target = hooksPath(cwd, flags);
  const command = buildHookCommand();
  const update = await buildInstallUpdate(target, command);
  if (!hasFlag(flags, 'dry-run')) await writeHooksUpdate(target, update.next, update.backupPath, update.existed);
  return {
    host: 'codex',
    action: 'install',
    passive: true,
    dryRun: hasFlag(flags, 'dry-run'),
    target,
    backupPath: update.backupPath,
    command,
    changed: update.changed,
    note: 'Codex requires /hooks review/trust before non-managed command hooks run.',
    summary: `${hasFlag(flags, 'dry-run') ? 'Would install' : 'Installed'} SkillMap passive Codex UserPromptSubmit hook at ${target}${update.changed ? '' : ' (already present)'}.`
  };
}

async function uninstallCodexHook(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const target = hooksPath(cwd, flags);
  const update = await buildUninstallUpdate(target);
  if (!hasFlag(flags, 'dry-run') && update.existed) await writeHooksUpdate(target, update.next, update.backupPath, update.existed);
  return {
    host: 'codex',
    action: 'uninstall',
    dryRun: hasFlag(flags, 'dry-run'),
    target,
    backupPath: update.backupPath,
    changed: update.changed,
    summary: `${hasFlag(flags, 'dry-run') ? 'Would uninstall' : 'Uninstalled'} SkillMap passive Codex hook at ${target}${update.changed ? '' : ' (not present)'}.`
  };
}

function hooksPath(cwd: string, flags: Record<string, string | boolean | string[]>): string {
  const explicit = flagString(flags, 'config');
  if (explicit) return path.resolve(cwd, explicit);
  if (hasFlag(flags, 'global')) return path.join(os.homedir(), '.codex', 'hooks.json');
  return path.join(cwd, '.codex', 'hooks.json');
}

function buildHookCommand(): string {
  const node = shellQuote(process.execPath);
  const cli = shellQuote(path.resolve(process.argv[1]));
  return `${node} ${cli} route --hook --max 3`;
}

async function buildInstallUpdate(target: string, command: string): Promise<{ next: HooksFile; backupPath: string; changed: boolean; existed: boolean }> {
  const { file, existed } = await readHooksFile(target);
  const next: HooksFile = { ...file, hooks: { ...(file.hooks ?? {}) } };
  const groups = [...(next.hooks?.UserPromptSubmit ?? [])];
  const hasSkillMap = groups.some((group) => (group.hooks ?? []).some(isSkillMapHook));
  if (!hasSkillMap) {
    groups.push({ hooks: [{ type: 'command', command, timeout: 5 }] });
    next.hooks = { ...(next.hooks ?? {}), UserPromptSubmit: groups };
  }
  return { next, backupPath: backupPath(target), changed: !hasSkillMap, existed };
}

async function buildUninstallUpdate(target: string): Promise<{ next: HooksFile; backupPath: string; changed: boolean; existed: boolean }> {
  const { file, existed } = await readHooksFile(target);
  const next: HooksFile = { ...file, hooks: { ...(file.hooks ?? {}) } };
  const groups = [...(next.hooks?.UserPromptSubmit ?? [])];
  let changed = false;
  const cleaned = groups.map((group) => {
    const before = group.hooks ?? [];
    const after = before.filter((hook) => !isSkillMapHook(hook));
    if (after.length !== before.length) changed = true;
    return { ...group, hooks: after };
  }).filter((group) => (group.hooks ?? []).length > 0);
  if (cleaned.length > 0) next.hooks = { ...(next.hooks ?? {}), UserPromptSubmit: cleaned };
  else if (next.hooks) delete next.hooks.UserPromptSubmit;
  return { next, backupPath: backupPath(target), changed, existed };
}

async function readHooksFile(target: string): Promise<{ file: HooksFile; existed: boolean }> {
  try {
    const raw = await readFile(target, 'utf8');
    const parsed = JSON.parse(raw) as HooksFile;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('hooks.json root must be an object.');
    return { file: parsed, existed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { file: { hooks: {} }, existed: false };
    throw error;
  }
}

async function writeHooksUpdate(target: string, next: HooksFile, backup: string, existed: boolean): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  if (existed) await copyFile(target, backup);
  const temp = `${target}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(temp, target);
  await chmod(target, 0o600);
}

function isSkillMapHook(hook: HookHandler): boolean {
  return hook.type === 'command' && typeof hook.command === 'string' && hook.command.includes(' route --hook') && (hook.command.includes('skillmap') || hook.command.includes('cli.js'));
}

function backupPath(target: string): string {
  return `${target}.skillmap-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
