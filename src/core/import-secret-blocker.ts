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

const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |DSA |EC |ENCRYPTED |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/u;
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
  | 'invalid_image'
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
  const mediaType = input.mediaType.toLowerCase().split(';', 1)[0].trim();
  if (INERT_IMAGE_MEDIA_TYPES.has(mediaType)) {
    if (!isStructurallyValidImage(input.content, mediaType)) {
      return blocked('IMPORT_SECRET_SCAN_UNSAFE', 'invalid_image');
    }
    const imageText = decodeBinaryForSecretScan(input.content);
    if (PRIVATE_KEY_PATTERN.test(imageText)) return blocked('IMPORT_SECRET_BLOCKED', 'private_key');
    if (HIGH_CONFIDENCE_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(imageText))) {
      return blocked('IMPORT_SECRET_BLOCKED', 'credential_pattern');
    }
    if (containsCredentialAssignment(imageText)) return blocked('IMPORT_SECRET_BLOCKED', 'credential_assignment');
    return { decision: 'allowed' };
  }
  if (!isTextMediaType(mediaType)) return blocked('IMPORT_SECRET_SCAN_UNSAFE', 'unscannable_binary');

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

function decodeBinaryForSecretScan(content: Uint8Array): string {
  return new TextDecoder('latin1').decode(content);
}

function isStructurallyValidImage(content: Uint8Array, mediaType: string): boolean {
  switch (mediaType) {
    case 'image/png':
      return isStructurallyValidPng(content);
    case 'image/jpeg':
      return isStructurallyValidJpeg(content);
    case 'image/gif':
      return isStructurallyValidGif(content);
    case 'image/webp':
      return isStructurallyValidWebp(content);
    default:
      return false;
  }
}

function isStructurallyValidPng(content: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (content.length < signature.length || !signature.every((byte, index) => content[index] === byte)) return false;

  let offset = signature.length;
  let sawHeader = false;
  let sawData = false;
  while (offset < content.length) {
    if (offset + 12 > content.length) return false;
    const length = readUint32Be(content, offset);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const dataEnd = dataOffset + length;
    const crcOffset = dataEnd;
    const chunkEnd = crcOffset + 4;
    if (dataEnd < dataOffset || chunkEnd > content.length) return false;
    if (!isAsciiChunkType(content, typeOffset)) return false;
    const type = ascii4(content, typeOffset);
    if (crc32(content.subarray(typeOffset, dataEnd)) !== readUint32Be(content, crcOffset)) return false;

    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = readUint32Be(content, dataOffset);
      const height = readUint32Be(content, dataOffset + 4);
      const bitDepth = content[dataOffset + 8];
      const colorType = content[dataOffset + 9];
      if (width === 0 || height === 0 || !isValidPngColorFormat(bitDepth, colorType)) return false;
      sawHeader = true;
    } else if (type === 'IHDR') {
      return false;
    }

    if (type === 'IDAT') sawData = true;
    if (type === 'IEND') {
      if (length !== 0 || !sawHeader || !sawData || chunkEnd !== content.length) return false;
      return true;
    }
    offset = chunkEnd;
  }
  return false;
}

function isValidPngColorFormat(bitDepth: number, colorType: number): boolean {
  const validDepths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  };
  return validDepths[colorType]?.includes(bitDepth) ?? false;
}

function isStructurallyValidJpeg(content: Uint8Array): boolean {
  if (content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8) return false;
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;

  while (offset < content.length) {
    if (content[offset++] !== 0xff) return false;
    while (offset < content.length && content[offset] === 0xff) offset++;
    if (offset >= content.length) return false;
    const marker = content[offset++];
    if (marker === 0xd9) return sawFrame && sawScan && offset === content.length;
    if (marker === 0xd8 || marker === 0x00) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > content.length) return false;
    const segmentLength = (content[offset] << 8) | content[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > content.length) return false;
    const segmentData = offset + 2;
    const segmentEnd = offset + segmentLength;

    if (isJpegFrameMarker(marker)) {
      if (segmentLength < 8) return false;
      const height = (content[segmentData + 1] << 8) | content[segmentData + 2];
      const width = (content[segmentData + 3] << 8) | content[segmentData + 4];
      if (width === 0 || height === 0) return false;
      sawFrame = true;
    }
    offset = segmentEnd;

    if (marker === 0xda) {
      sawScan = true;
      while (offset < content.length) {
        if (content[offset] !== 0xff) {
          offset++;
          continue;
        }
        let markerOffset = offset + 1;
        while (markerOffset < content.length && content[markerOffset] === 0xff) markerOffset++;
        if (markerOffset >= content.length) return false;
        const scanMarker = content[markerOffset];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          offset = markerOffset + 1;
          continue;
        }
        if (scanMarker === 0xd9) return sawFrame && markerOffset + 1 === content.length;
        break;
      }
      if (offset >= content.length) return false;
    }
  }
  return false;
}

function isJpegFrameMarker(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
    || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
}

function isStructurallyValidGif(content: Uint8Array): boolean {
  if (content.length < 13) return false;
  const header = ascii3(content, 0);
  if (header !== 'GIF' || (ascii3(content, 3) !== '87a' && ascii3(content, 3) !== '89a')) return false;
  const width = content[6] | (content[7] << 8);
  const height = content[8] | (content[9] << 8);
  if (width === 0 || height === 0) return false;
  const packed = content[10];
  let offset = 13;
  if ((packed & 0x80) !== 0) {
    offset += 3 * (1 << ((packed & 0x07) + 1));
    if (offset > content.length) return false;
  }
  let sawImage = false;
  while (offset < content.length) {
    const introducer = content[offset++];
    if (introducer === 0x3b) return sawImage && offset === content.length;
    if (introducer === 0x21) {
      if (offset >= content.length) return false;
      const label = content[offset++];
      if (label === 0xf9) {
        if (offset >= content.length || content[offset++] !== 4 || offset + 4 >= content.length) return false;
        offset += 4;
        if (content[offset++] !== 0) return false;
      } else if (label === 0x01) {
        if (offset >= content.length) return false;
        const blockSize = content[offset++];
        if (blockSize !== 12 || offset + blockSize > content.length) return false;
        offset += blockSize;
        const result = skipGifSubBlocks(content, offset);
        if (!result) return false;
        offset = result;
      } else if (label === 0xff) {
        if (offset >= content.length) return false;
        const blockSize = content[offset++];
        if (blockSize !== 11 || offset + blockSize > content.length) return false;
        offset += blockSize;
        const result = skipGifSubBlocks(content, offset);
        if (!result) return false;
        offset = result;
      } else {
        const result = skipGifSubBlocks(content, offset);
        if (!result) return false;
        offset = result;
      }
      continue;
    }
    if (introducer !== 0x2c || offset + 9 > content.length) return false;
    const imageWidth = content[offset + 4] | (content[offset + 5] << 8);
    const imageHeight = content[offset + 6] | (content[offset + 7] << 8);
    const imagePacked = content[offset + 8];
    if (imageWidth === 0 || imageHeight === 0) return false;
    offset += 9;
    if ((imagePacked & 0x80) !== 0) {
      offset += 3 * (1 << ((imagePacked & 0x07) + 1));
      if (offset > content.length) return false;
    }
    if (offset >= content.length || content[offset++] < 2 || content[offset - 1] > 8) return false;
    const result = skipGifSubBlocks(content, offset);
    if (!result) return false;
    offset = result;
    sawImage = true;
  }
  return false;
}

function skipGifSubBlocks(content: Uint8Array, offset: number): number | undefined {
  let sawBlock = false;
  while (offset < content.length) {
    const size = content[offset++];
    if (size === 0) return sawBlock ? offset : undefined;
    if (offset + size > content.length) return undefined;
    offset += size;
    sawBlock = true;
  }
  return undefined;
}

function isStructurallyValidWebp(content: Uint8Array): boolean {
  if (content.length < 20 || ascii4(content, 0) !== 'RIFF' || ascii4(content, 8) !== 'WEBP') return false;
  if (readUint32Le(content, 4) !== content.length - 8) return false;
  let offset = 12;
  let sawImage = false;
  while (offset < content.length) {
    if (offset + 8 > content.length) return false;
    const type = ascii4(content, offset);
    const size = readUint32Le(content, offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + size;
    const chunkEnd = dataEnd + (size & 1);
    if (dataEnd < dataOffset || chunkEnd > content.length) return false;
    if (type === 'VP8 ') {
      if (size < 10 || content[dataOffset + 3] !== 0x9d || content[dataOffset + 4] !== 0x01 || content[dataOffset + 5] !== 0x2a) return false;
      const width = (content[dataOffset + 6] | (content[dataOffset + 7] << 8)) & 0x3fff;
      const height = (content[dataOffset + 8] | (content[dataOffset + 9] << 8)) & 0x3fff;
      if (width === 0 || height === 0) return false;
      sawImage = true;
    } else if (type === 'VP8L') {
      if (size < 5 || content[dataOffset] !== 0x2f) return false;
      const width = 1 + (content[dataOffset + 1] | ((content[dataOffset + 2] & 0x3f) << 8));
      const height = 1 + ((content[dataOffset + 2] >> 6) | (content[dataOffset + 3] << 2) | ((content[dataOffset + 4] & 0x03) << 10));
      if (width === 0 || height === 0) return false;
      sawImage = true;
    } else if (type === 'VP8X') {
      if (size < 10) return false;
      const width = 1 + content[dataOffset + 4] + (content[dataOffset + 5] << 8) + (content[dataOffset + 6] << 16);
      const height = 1 + content[dataOffset + 7] + (content[dataOffset + 8] << 8) + (content[dataOffset + 9] << 16);
      if (width === 0 || height === 0) return false;
    }
    offset = chunkEnd;
  }
  return sawImage && offset === content.length;
}

function isAsciiChunkType(content: Uint8Array, offset: number): boolean {
  return content.slice(offset, offset + 4).every((byte) => (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a));
}

function ascii3(content: Uint8Array, offset: number): string {
  return String.fromCharCode(content[offset] ?? 0, content[offset + 1] ?? 0, content[offset + 2] ?? 0);
}

function ascii4(content: Uint8Array, offset: number): string {
  return String.fromCharCode(content[offset] ?? 0, content[offset + 1] ?? 0, content[offset + 2] ?? 0, content[offset + 3] ?? 0);
}

function readUint32Be(content: Uint8Array, offset: number): number {
  return ((content[offset] ?? 0) * 0x1000000) + ((content[offset + 1] ?? 0) << 16) + ((content[offset + 2] ?? 0) << 8) + (content[offset + 3] ?? 0);
}

function readUint32Le(content: Uint8Array, offset: number): number {
  return (content[offset] ?? 0) + ((content[offset + 1] ?? 0) << 8) + ((content[offset + 2] ?? 0) << 16) + ((content[offset + 3] ?? 0) * 0x1000000);
}

function crc32(content: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
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
