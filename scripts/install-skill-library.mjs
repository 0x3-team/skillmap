#!/usr/bin/env node

import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(repo, 'catalog', 'skill-library.json'), 'utf8'));
const args = process.argv.slice(2);

function value(flag, fallback) {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
}

function has(flag) {
  return args.includes(flag);
}

function usage() {
  console.log(`Usage:
  node scripts/install-skill-library.mjs --list
  node scripts/install-skill-library.mjs --target lovable --skill NAME
  node scripts/install-skill-library.mjs --target agents|codex|claude|copilot|cursor --skill NAME|all [--scope global|project] [--project-root PATH] [--dry-run] [--force]
  node scripts/install-skill-library.mjs --target custom --dest PATH --skill NAME|all [--dry-run] [--force]`);
}

function destinationFor(target, scope, projectRoot) {
  const global = {
    agents: path.join(os.homedir(), '.agents', 'skills'),
    codex: path.join(os.homedir(), '.codex', 'skills'),
    claude: path.join(os.homedir(), '.claude', 'skills'),
    copilot: path.join(os.homedir(), '.copilot', 'skills'),
    cursor: path.join(os.homedir(), '.cursor', 'skills')
  };
  const project = {
    agents: path.join(projectRoot, '.agents', 'skills'),
    codex: path.join(projectRoot, '.agents', 'skills'),
    claude: path.join(projectRoot, '.claude', 'skills'),
    copilot: path.join(projectRoot, '.github', 'skills'),
    cursor: path.join(projectRoot, '.cursor', 'skills')
  };
  const selected = scope === 'project' ? project : global;
  if (!selected[target]) throw new Error(`Unsupported target: ${target}`);
  return selected[target];
}

async function exists(target) {
  return stat(target).then(() => true, () => false);
}

if (has('--help') || args.length === 0) {
  usage();
  process.exit(0);
}

if (has('--list')) {
  for (const skill of manifest.skills) console.log(skill.name);
  process.exit(0);
}

const target = value('--target');
const requested = value('--skill');
if (!target || !requested) throw new Error('--target and --skill are required.');
const selected = requested === 'all'
  ? manifest.skills
  : manifest.skills.filter(skill => skill.name === requested);
if (selected.length === 0) throw new Error(`Unknown skill: ${requested}`);

if (target === 'lovable') {
  const payload = {
    target: 'lovable',
    repositoryMustBePublic: true,
    skills: selected.map(skill => ({ name: skill.name, importUrl: skill.compatibility.lovableImportUrl }))
  };
  if (has('--json')) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log('Lovable GitHub imports require this repository to be public.');
    for (const skill of payload.skills) console.log(`${skill.name}: ${skill.importUrl}`);
  }
  process.exit(0);
}

const scope = value('--scope', 'global');
if (!['global', 'project'].includes(scope)) throw new Error('--scope must be global or project.');
const projectRoot = path.resolve(value('--project-root', process.cwd()));
const destination = target === 'custom'
  ? path.resolve(value('--dest') ?? (() => { throw new Error('--dest is required for target custom.'); })())
  : destinationFor(target, scope, projectRoot);
const dryRun = has('--dry-run');
const force = has('--force');
const results = [];

for (const skill of selected) {
  const source = path.join(repo, skill.path);
  const finalPath = path.join(destination, skill.name);
  const alreadyExists = await exists(finalPath);
  if (alreadyExists && !force) {
    results.push({ name: skill.name, status: 'skipped-existing', destination: finalPath });
    continue;
  }
  if (dryRun) {
    results.push({ name: skill.name, status: alreadyExists ? 'would-update-with-backup' : 'would-install', destination: finalPath });
    continue;
  }

  await mkdir(destination, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const staged = path.join(destination, `.${skill.name}.skillmap-stage-${nonce}`);
  await rm(staged, { recursive: true, force: true });
  await cp(source, staged, { recursive: true, errorOnExist: true });
  let backup;
  if (alreadyExists) {
    backup = path.join(destination, `${skill.name}.skillmap-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await rename(finalPath, backup);
  }
  try {
    await rename(staged, finalPath);
  } catch (error) {
    if (backup) await rename(backup, finalPath);
    throw error;
  }
  results.push({ name: skill.name, status: alreadyExists ? 'updated-with-backup' : 'installed', destination: finalPath, backup });
}

if (has('--json')) console.log(JSON.stringify({ target, scope, destination, dryRun, results }, null, 2));
else {
  for (const result of results) {
    console.log(`${result.name}: ${result.status} -> ${result.destination}${result.backup ? ` (backup: ${result.backup})` : ''}`);
  }
}
