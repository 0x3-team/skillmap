export const MAX_DISPLAY_NAME_LENGTH = 200;

const UNSAFE_DISPLAY_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

export function isSafeDisplayName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_DISPLAY_NAME_LENGTH
    && value === value.trim()
    && !UNSAFE_DISPLAY_CHARACTER.test(value);
}

export function safeFallbackDisplayName(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
  const bounded = Array.from(normalized).slice(0, MAX_DISPLAY_NAME_LENGTH).join('').trim();
  return bounded || 'unnamed-skill';
}
