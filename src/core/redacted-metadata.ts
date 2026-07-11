import { containsFilesystemLocation, containsSensitiveText } from './api-envelope.js';
import { isSafeDisplayName } from './display-name.js';

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const CONTROL_GLOBAL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;

/** Project untrusted local metadata into a bounded public label. */
export function redactedMetadataLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  if (CONTROL.test(value)) return fallback;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!isSafeDisplayName(normalized) || containsFilesystemLocation(normalized) || containsSensitiveText(normalized)) return fallback;
  return normalized;
}

/** Public descriptions never return path- or secret-bearing source metadata. */
export function redactedMetadataDescription(value: unknown, maxLength = 500): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(CONTROL_GLOBAL, ' ').replace(/\s+/gu, ' ').trim();
  if (!normalized) return '';
  if (containsFilesystemLocation(normalized) || containsSensitiveText(normalized)) return 'Description withheld because it contains sensitive local metadata.';
  return Array.from(normalized).slice(0, Math.max(0, maxLength)).join('');
}
