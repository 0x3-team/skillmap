export const IMPORT_SECRET_SCAN_MAX_BYTES = 16 * 1024 * 1024;

const TEXT_MEDIA_TYPES = new Set([
  'application/json',
  'application/toml',
  'application/yaml',
  'text/markdown',
  'text/markdown; charset=utf-8',
  'text/plain',
  'text/plain; charset=utf-8'
]);

const INERT_IMAGE_MEDIA_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const FORBIDDEN_EXACT_NAMES = new Set([
  '.netrc',
  '.npmrc',
  '.pypirc',
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'service-account.json',
  'service_account.json'
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.jks',
  '.key',
  '.keystore',
  '.p12',
  '.pfx',
  '.pkcs12'
]);

const PRIVATE_KEY_PATTERN = /-----BEGIN (?:DSA |EC |ENCRYPTED |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/u;
const HIGH_CONFIDENCE_CREDENTIAL_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{30,255}\b/u,
  /\bnpm_[A-Za-z0-9]{36,255}\b/u,
  /\bsk-(?:proj-|ant-api\d{2}-)?[A-Za-z0-9_-]{20,255}\b/u,
  /\bsk_live_[A-Za-z0-9]{20,255}\b/u,
  /\bglpat-[A-Za-z0-9_-]{20,255}\b/u,
  /\bhf_[A-Za-z0-9]{30,255}\b/u,
  /\bsbp_[A-Za-z0-9]{40,255}\b/u
] as const;

const CREDENTIAL_ASSIGNMENT_PATTERN = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|private[_-]?key|secret|token)\b\s*[:=]\s*["']?([^\s"'`]{20,512})/giu;
const PLACEHOLDER_PATTERN = /^(?:\$\{[^}]+\}|<[^>]+>|\[?redacted\]?|changeme|dummy|example|placeholder|replace[-_ ]?me|test|todo|your[-_ ]?[a-z0-9_-]+)$/iu;

export type ImportSecretBlockReason =
  | 'credential_assignment'
  | 'credential_pattern'
  | 'forbidden_filename'
  | 'invalid_utf8'
  | 'private_key'
  | 'scan_limit'
  | 'unscannable_binary';

export type ImportSecretInspection =
  | { decision: 'allowed' }
  | {
      decision: 'blocked';
      code: 'IMPORT_SECRET_BLOCKED' | 'IMPORT_SECRET_SCAN_LIMIT' | 'IMPORT_SECRET_SCAN_UNSAFE';
      reason: ImportSecretBlockReason;
    };

export interface ImportSecretInspectionInput {
  relativePath: string;
  content: Uint8Array;
  mediaType: string;
}

/**
 * Returns only bounded classifications. It never returns a path, matched bytes,
 * offsets, decoded content, or pattern text.
 */
export function inspectImportFileForSecrets(input: ImportSecretInspectionInput): ImportSecretInspection {
  if (isForbiddenCredentialPath(input.relativePath)) return blocked('IMPORT_SECRET_BLOCKED', 'forbidden_filename');
  if (input.content.byteLength > IMPORT_SECRET_SCAN_MAX_BYTES) return blocked('IMPORT_SECRET_SCAN_LIMIT', 'scan_limit');
  if (INERT_IMAGE_MEDIA_TYPES.has(input.mediaType)) return { decision: 'allowed' };
  if (!isTextMediaType(input.mediaType)) return blocked('IMPORT_SECRET_SCAN_UNSAFE', 'unscannable_binary');

  const decoded = decodeUtf8(input.content);
  if (decoded === null) return blocked('IMPORT_SECRET_SCAN_UNSAFE', 'invalid_utf8');
  if (PRIVATE_KEY_PATTERN.test(decoded)) return blocked('IMPORT_SECRET_BLOCKED', 'private_key');
  if (HIGH_CONFIDENCE_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(decoded))) {
    return blocked('IMPORT_SECRET_BLOCKED', 'credential_pattern');
  }
  if (containsCredentialAssignment(decoded)) return blocked('IMPORT_SECRET_BLOCKED', 'credential_assignment');
  return { decision: 'allowed' };
}

export function isForbiddenCredentialPath(relativePath: string): boolean {
  const normalized = relativePath.normalize('NFC').replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  const basename = segments.at(-1)?.toLowerCase() ?? '';
  const lowerPath = segments.map((segment) => segment.toLowerCase()).join('/');

  if (basename.startsWith('.env')) return true;
  if (FORBIDDEN_EXACT_NAMES.has(basename)) return true;
  if (FORBIDDEN_EXTENSIONS.has(extensionOf(basename))) return true;
  if (lowerPath === '.aws/credentials' || lowerPath.endsWith('/.aws/credentials')) return true;
  if (lowerPath === '.config/gcloud/application_default_credentials.json'
    || lowerPath.endsWith('/.config/gcloud/application_default_credentials.json')) return true;
  if (/^(?:service[-_]?account|private[-_]?key)(?:[-_.][a-z0-9._-]+)?$/u.test(basename)) return true;
  return false;
}

function isTextMediaType(mediaType: string): boolean {
  return TEXT_MEDIA_TYPES.has(mediaType) || mediaType.startsWith('text/');
}

function decodeUtf8(content: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

function containsCredentialAssignment(content: string): boolean {
  CREDENTIAL_ASSIGNMENT_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(CREDENTIAL_ASSIGNMENT_PATTERN)) {
    const candidate = match[1].replace(/[),.;]+$/u, '');
    if (PLACEHOLDER_PATTERN.test(candidate)) continue;
    if (candidate.length >= 20) return true;
  }
  return false;
}

function extensionOf(basename: string): string {
  const index = basename.lastIndexOf('.');
  return index <= 0 ? '' : basename.slice(index);
}

function blocked(
  code: 'IMPORT_SECRET_BLOCKED' | 'IMPORT_SECRET_SCAN_LIMIT' | 'IMPORT_SECRET_SCAN_UNSAFE',
  reason: ImportSecretBlockReason
): ImportSecretInspection {
  return { decision: 'blocked', code, reason };
}
