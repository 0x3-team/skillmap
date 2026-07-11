import { parse } from 'yaml';
import { isSafeDisplayName, MAX_DISPLAY_NAME_LENGTH } from './display-name.js';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
  valid: boolean;
  errors: string[];
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const errors: string[] = [];
  if (!content.startsWith('---\n')) {
    return { data: {}, body: content, valid: false, errors: ['missing YAML frontmatter opening delimiter'] };
  }
  const end = content.indexOf('\n---', 4);
  if (end < 0) {
    return { data: {}, body: content, valid: false, errors: ['missing YAML frontmatter closing delimiter'] };
  }
  const raw = content.slice(4, end).trim();
  const body = content.slice(content.indexOf('\n', end + 1) + 1);
  let data: Record<string, unknown> = {};
  let recoveredFromYamlError = false;
  try {
    const parsed = parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    } else {
      errors.push('frontmatter must parse to an object');
    }
  } catch (error) {
    data = parseTopLevelFallback(raw);
    recoveredFromYamlError = typeof data.name === 'string' && data.name.trim().length > 0;
    errors.push(error instanceof Error ? `YAML parse warning recovered by fallback: ${error.message}` : 'YAML parse warning recovered by fallback');
  }
  if (typeof data.name !== 'string' || !data.name.trim()) errors.push('missing required string field: name');
  else {
    const name = data.name.trim();
    if (name.length > MAX_DISPLAY_NAME_LENGTH) errors.push(`name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`);
    if (!isSafeDisplayName(name)) errors.push('name must be a bounded single-line label without control characters');
  }
  if (data.description !== undefined && typeof data.description !== 'string') errors.push('description must be a string when present');
  const blockingErrors = errors.filter((error) => !error.startsWith('YAML parse warning recovered by fallback'));
  return { data, body, valid: blockingErrors.length === 0 && (errors.length === 0 || recoveredFromYamlError), errors };
}

function parseTopLevelFallback(raw: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (value === 'true') data[key] = true;
    else if (value === 'false') data[key] = false;
    else data[key] = stripQuotes(value);
  }
  return data;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}
