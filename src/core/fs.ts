import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function writeText(file: string, value: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, value.endsWith('\n') ? value : `${value}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function hashFile(file: string): Promise<string> {
  return hashText(await readFile(file, 'utf8'));
}

export function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
