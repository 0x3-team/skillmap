import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(file: string, value: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}
