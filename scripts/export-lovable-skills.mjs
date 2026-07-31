#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipEntry(name, bytes, offset) {
  const encodedName = Buffer.from(name, 'utf8');
  const checksum = crc32(bytes);
  const dosDate = 0x0021;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(encodedName.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(encodedName.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  return {
    local: Buffer.concat([local, encodedName, bytes]),
    central: Buffer.concat([central, encodedName])
  };
}

async function createArchive(skill) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of skill.files) {
    const bytes = await readFile(path.join(repo, skill.path, ...file.path.split('/')));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== file.sha256) throw new Error(`${skill.name}/${file.path} differs from the generated manifest.`);
    const entry = zipEntry(`${skill.name}/${file.path}`, bytes, offset);
    localParts.push(entry.local);
    centralParts.push(entry.central);
    offset += entry.local.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(skill.files.length, 8);
  end.writeUInt16LE(skill.files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

const requested = value('--skill');
const outputDirectory = path.resolve(value('--output', path.join(repo, 'artifacts', 'lovable-skills')));
if (!requested) throw new Error('--skill NAME|all is required.');
const selected = requested === 'all' ? manifest.skills : manifest.skills.filter(skill => skill.name === requested);
if (selected.length === 0) throw new Error(`Unknown skill: ${requested}`);
await mkdir(outputDirectory, { recursive: true });

const results = [];
for (const skill of selected) {
  const target = path.join(outputDirectory, `${skill.name}.zip`);
  const targetExists = await stat(target).then(() => true, () => false);
  if (targetExists && !has('--force')) throw new Error(`Refusing to overwrite ${target}; pass --force.`);
  const archive = await createArchive(skill);
  await writeFile(target, archive, { flag: has('--force') ? 'w' : 'wx' });
  results.push({ name: skill.name, output: target, bytes: archive.length, files: skill.files.length });
}

if (has('--json')) console.log(JSON.stringify({ format: 'zip', wrappingFolder: true, results }, null, 2));
else for (const result of results) console.log(`${result.name}: ${result.output} (${result.files} files, ${result.bytes} bytes)`);
