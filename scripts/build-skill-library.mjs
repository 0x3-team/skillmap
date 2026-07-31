#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(repo, 'skills');
const lockPath = path.join(repo, 'skill-sources.lock.json');
const outputPath = path.join(repo, 'catalog', 'skill-library.json');
const check = process.argv.includes('--check');

const LOVABLE_LIMITS = Object.freeze({
  maxFiles: 200,
  maxTotalBytes: 10 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxSkillCharacters: 100_000
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedRelative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

async function collectFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`Portable skills cannot contain symlinks: ${normalizedRelative(root, absolute)}`);
    if (entry.isDirectory()) files.push(...await collectFiles(root, absolute));
    else if (entry.isFile()) files.push(absolute);
    else throw new Error(`Unsupported skill entry type: ${normalizedRelative(root, absolute)}`);
  }
  return files.sort((left, right) => normalizedRelative(root, left).localeCompare(normalizedRelative(root, right), 'en'));
}

function parseFrontmatter(source, skillName) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw new Error(`${skillName}/SKILL.md is missing YAML frontmatter.`);
  const frontmatter = YAML.parse(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`${skillName}/SKILL.md frontmatter must be a mapping.`);
  }
  return frontmatter;
}

function sourceForSkill(lock, name) {
  for (const source of lock.sources) {
    if (source.skills && Object.hasOwn(source.skills, name)) {
      return { source, sourcePath: source.skills[name] };
    }
    if (source.include === '*' && !(source.exclude ?? []).includes(name)) {
      return { source, sourcePath: source.pathTemplate.replace('{name}', name) };
    }
  }
  throw new Error(`No immutable source mapping exists for ${name}.`);
}

async function buildSkillRecord(lock, directory) {
  const name = directory.name;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error(`Invalid portable skill directory name: ${name}`);
  }

  const skillRoot = path.join(skillsRoot, name);
  const skillPath = path.join(skillRoot, 'SKILL.md');
  const skillSource = await readFile(skillPath, 'utf8');
  const frontmatter = parseFrontmatter(skillSource, name);
  if (frontmatter.name !== name) throw new Error(`${name}/SKILL.md name must match its parent directory.`);
  if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) {
    throw new Error(`${name}/SKILL.md requires a non-empty description.`);
  }
  if (frontmatter.description.length > 1024) throw new Error(`${name}/SKILL.md description exceeds 1024 characters.`);

  const files = await collectFiles(skillRoot);
  const fileRecords = [];
  let totalBytes = 0;
  let largestFileBytes = 0;
  for (const file of files) {
    const bytes = await readFile(file);
    totalBytes += bytes.length;
    largestFileBytes = Math.max(largestFileBytes, bytes.length);
    fileRecords.push({
      path: normalizedRelative(skillRoot, file),
      bytes: bytes.length,
      sha256: sha256(bytes)
    });
  }

  const lovableCompatible = files.length <= LOVABLE_LIMITS.maxFiles
    && totalBytes <= LOVABLE_LIMITS.maxTotalBytes
    && largestFileBytes <= LOVABLE_LIMITS.maxFileBytes
    && skillSource.length <= LOVABLE_LIMITS.maxSkillCharacters;
  if (!lovableCompatible) throw new Error(`${name} exceeds the checked Lovable package limits.`);

  const { source, sourcePath } = sourceForSkill(lock, name);
  const treeDigest = sha256(fileRecords.map(file => `${file.path}\0${file.bytes}\0${file.sha256}`).join('\n'));
  const hasExecutableContent = fileRecords.some(file =>
    file.path.startsWith('scripts/')
    || /\.(?:bat|cmd|exe|jar|js|mjs|ps1|py|sh|ts)$/i.test(file.path)
  );
  return {
    name,
    description: frontmatter.description,
    path: `skills/${name}`,
    entrypoint: `skills/${name}/SKILL.md`,
    source: {
      id: source.id,
      repository: source.repository,
      commit: source.commit,
      path: sourcePath,
      license: frontmatter.license ?? source.license
    },
    normalizations: lock.normalizations?.[name] ?? [],
    review: {
      status: 'unreviewed',
      hasExecutableContent,
      autoUseRecommended: false
    },
    integrity: {
      algorithm: 'sha256',
      treeDigest,
      fileCount: fileRecords.length,
      totalBytes,
      largestFileBytes
    },
    compatibility: {
      agentSkills: true,
      lovable: true,
      lovableImportUrl: `https://github.com/0x3-team/skillmap/tree/main/skills/${name}`
    },
    files: fileRecords
  };
}

const lock = JSON.parse(await readFile(lockPath, 'utf8'));
if (lock.schemaVersion !== 'skillmap.skill-sources/v1') throw new Error('Unsupported skill source lock schema.');
const directories = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name, 'en'));
const skills = [];
for (const directory of directories) skills.push(await buildSkillRecord(lock, directory));

const manifest = {
  schemaVersion: 'skillmap.skill-library/v1',
  specification: lock.agentSkillsSpecification,
  repository: 'https://github.com/0x3-team/skillmap',
  repositoryVisibility: 'private-at-build-time',
  lovableRequirement: 'GitHub URL imports require a public repository. Use ZIP upload while this repository remains private.',
  limits: { lovable: LOVABLE_LIMITS },
  skillCount: skills.length,
  excluded: lock.excluded,
  skills
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

if (check) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== serialized) {
    console.error('catalog/skill-library.json is stale. Run `npm run skills:build`.');
    process.exitCode = 1;
  } else {
    console.log(`Portable skill library is current (${skills.length} skills).`);
  }
} else {
  await writeFile(outputPath, serialized, 'utf8');
  console.log(`Wrote catalog/skill-library.json (${skills.length} skills).`);
}
