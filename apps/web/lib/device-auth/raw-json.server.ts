/* Strict raw JSON reader for DeviceAuth (M3.02 Decision 4).
 *
 * DeviceAuth configures strict JSON: no comments, no trailing data, no BOM,
 * no NUL, no duplicate decoded keys (including "a" vs "a"), and no
 * overlong/over-deep structures. The exact wire bytes are retained unchanged
 * so the body SHA-256 and proof/idempotency preimages stay byte-accurate.
 *
 * This is a self-contained recursive-descent parser (no jsonc-parser
 * dependency) so behavior is identical on Node, Next, and OpenNext Workerd.
 * It rejects every parse error and never falls back to JSON.parse for
 * authority.
 */

import { DeviceAuthError } from "./errors.ts";

/** Maximum accepted request body bytes (bounded; oversized is rejected). */
export const DEVICE_AUTH_MAX_BODY_BYTES = 16 * 1024;
/** Maximum JSON nesting depth. */
const MAX_DEPTH = 32;
/** Maximum members in a single object (including nesting). */
const MAX_OBJECT_MEMBERS = 128;
/** Maximum items in a single array. */
const MAX_ARRAY_ITEMS = 2048;

export class StrictDeviceAuthJsonError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "StrictDeviceAuthJsonError";
  }
}

/**
 * Read a request stream exactly once with a byte ceiling. Returns the exact
 * UTF-8 bytes for body hashing.
 */
export async function readDeviceAuthBody(
  request: Request,
  maxBytes: number = DEVICE_AUTH_MAX_BODY_BYTES
): Promise<Uint8Array> {
  const lengthHeader = request.headers.get("content-length");
  let declaredLength: number | null = null;
  if (lengthHeader !== null) {
    if (!/^\d+$/.test(lengthHeader)) throw new StrictDeviceAuthJsonError("invalid content length.");
    const declared = Number(lengthHeader);
    if (!Number.isSafeInteger(declared)) throw new StrictDeviceAuthJsonError("invalid content length.");
    declaredLength = declared;
    if (declared > maxBytes) {
      await cancelBodyStream(request.body);
      throw new StrictDeviceAuthJsonError("request body too large.");
    }
  }

  const body = request.body;
  if (body === null) {
    if (declaredLength !== null && declaredLength !== 0) {
      throw new StrictDeviceAuthJsonError("content length does not match request body.");
    }
    return new Uint8Array(0);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        await cancelBodyReader(reader);
        throw new StrictDeviceAuthJsonError("request body could not be read.");
      }
      if (result.done) break;

      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) {
        await cancelBodyReader(reader);
        throw new StrictDeviceAuthJsonError("request body could not be read.");
      }
      const remaining = maxBytes - total;
      // The first byte beyond the ceiling is the over-limit sentinel. Cancel
      // immediately so an unknown-length/chunked body cannot be buffered in full.
      if (chunk.byteLength > remaining) {
        await cancelBodyReader(reader);
        throw new StrictDeviceAuthJsonError("request body too large.");
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }

    if (declaredLength !== null && total !== declaredLength) {
      throw new StrictDeviceAuthJsonError("content length does not match request body.");
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new StrictDeviceAuthJsonError("invalid UTF-8 request body.");
    }
    return bytes;
  } finally {
    reader.releaseLock();
  }
}

async function cancelBodyReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Preserve the deterministic request error that caused cancellation.
  }
}

async function cancelBodyStream(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (body === null) return;
  try {
    await body.cancel();
  } catch {
    // Preserve the deterministic request error that caused cancellation.
  }
}

/** Validate content-type is the allowed JSON type with an allowed charset. */
export function assertJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type");
  if (contentType === null) throw new StrictDeviceAuthJsonError("missing content type.");
  const lower = contentType.toLowerCase();
  const semicolon = lower.indexOf(";");
  const mediaType = (semicolon >= 0 ? lower.slice(0, semicolon) : lower).trim();
  if (mediaType !== "application/json") {
    throw new StrictDeviceAuthJsonError("content type must be application/json.");
  }
  const charset = (semicolon >= 0 ? lower.slice(semicolon + 1) : "").trim();
  if (charset !== "" && charset !== "charset=utf-8") {
    throw new StrictDeviceAuthJsonError("unsupported charset.");
  }
}

/** Reject any query component on DeviceAuth operations. */
export function assertNoQuery(url: URL): void {
  if (url.search.length > 0) {
    throw new StrictDeviceAuthJsonError("query parameters are not allowed.");
  }
}

/**
 * Strictly parse and fully validate UTF-8 JSON text. Returns the decoded plain
 * value. Throws StrictDeviceAuthJsonError on any violation.
 */
export interface StrictJsonLimits {
  /** Total object members across the document. Defaults to the DeviceAuth bound. */
  maxObjectMembers?: number;
  /** Maximum items in one array. Defaults to the DeviceAuth bound. */
  maxArrayItems?: number;
}

export function parseStrictDeviceAuthJson<T>(text: string, limits: StrictJsonLimits = {}): T {
  const parser = new StrictJsonScanner(text, limits);
  const root = parser.parseRoot();
  parser.finish();
  return root as T;
}

/** Return a plain value with a fresh origin. */
export function toUndefined(): undefined {
  return undefined;
}

/**
 * Scan-only validation; returns null when the source is valid, otherwise a
 * stable error reason. Part of the focused adversarial surface.
 */
export function tryParseStrict(text: string): string | null {
  try {
    parseStrictDeviceAuthJson(text);
    return null;
  } catch (error) {
    return error instanceof StrictDeviceAuthJsonError ? error.message : "invalid JSON";
  }
}

class StrictJsonScanner {
  private readonly text: string;
  private pos = 0;
  /** Total control/structural budget across the whole document. */
  private objectCount = 0;

  private readonly maxObjectMembers: number;
  private readonly maxArrayItems: number;

  constructor(text: string, limits: StrictJsonLimits = {}) {
    if (text.charCodeAt(0) === 0xfeff) throw new StrictDeviceAuthJsonError("UTF-8 BOM is not allowed.");
    this.text = text;
    this.maxObjectMembers = limits.maxObjectMembers ?? MAX_OBJECT_MEMBERS;
    this.maxArrayItems = limits.maxArrayItems ?? MAX_ARRAY_ITEMS;
    if (!Number.isSafeInteger(this.maxObjectMembers) || this.maxObjectMembers < 1
      || !Number.isSafeInteger(this.maxArrayItems) || this.maxArrayItems < 1) {
      throw new StrictDeviceAuthJsonError("invalid parser limits.");
    }
  }

  parseRoot(): unknown {
    const value = this.parseValue(0);
    return value;
  }

  finish(): void {
    this.skipWs();
    if (this.pos < this.text.length) {
      throw new StrictDeviceAuthJsonError("trailing data after JSON document.");
    }
  }

  private skipWs(): void {
    const text = this.text;
    const len = text.length;
    while (this.pos < len) {
      const c = text.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos++;
      else break;
    }
  }

  parseValue(depth = 0): unknown {
    if (depth > MAX_DEPTH) throw new StrictDeviceAuthJsonError("nesting too deep.");
    this.skipWs();
    if (this.pos >= this.text.length) throw new StrictDeviceAuthJsonError("unexpected end of input.");
    const c = this.text.charCodeAt(this.pos);
    if (c === 0x7b) return this.parseObject(depth);
    if (c === 0x5b) return this.parseArray(depth);
    if (c === 0x22) return this.parseString();
    if (c === 0x74) { this.literal("true"); return true; }
    if (c === 0x66) { this.literal("false"); return false; }
    if (c === 0x6e) { this.literal("null"); return null; }
    if (c === 0x2d || (c >= 0x30 && c <= 0x39)) return this.parseNumber();
    throw new StrictDeviceAuthJsonError("unexpected token.");
  }

  private literal(word: string): void {
    if (!this.text.startsWith(word, this.pos)) throw new StrictDeviceAuthJsonError("invalid literal.");
    this.pos += word.length;
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.pos++; // consume '{'
    this.skipWs();
    const seen = new Set<string>();
    const out: Record<string, unknown> = {};
    if (this.pos < this.text.length && this.text.charCodeAt(this.pos) === 0x7d) {
      this.pos++;
      return out;
    }
    for (;;) {
      this.objectCount++;
      if (this.objectCount > this.maxObjectMembers) throw new StrictDeviceAuthJsonError("too many object members.");
      this.skipWs();
      if (this.pos >= this.text.length || this.text.charCodeAt(this.pos) !== 0x22) {
        throw new StrictDeviceAuthJsonError("object key must be a string.");
      }
      const key = this.parseString();
      if (seen.has(key)) throw new StrictDeviceAuthJsonError("duplicate key.");
      seen.add(key);
      this.skipWs();
      if (this.pos >= this.text.length || this.text.charCodeAt(this.pos) !== 0x3a) {
        throw new StrictDeviceAuthJsonError("expected ':' between key and value.");
      }
      this.pos++;
      out[key] = this.parseValue(depth + 1);
      this.skipWs();
      if (this.pos < this.text.length && this.text.charCodeAt(this.pos) === 0x2c) {
        this.pos++;
        continue;
      }
      if (this.pos < this.text.length && this.text.charCodeAt(this.pos) === 0x7d) {
        this.pos++;
        return out;
      }
      throw new StrictDeviceAuthJsonError("expected ',' or '}'.");
    }
  }

  private parseArray(depth: number): unknown[] {
    this.pos++; // consume '['
    this.skipWs();
    const out: unknown[] = [];
    if (this.pos < this.text.length && this.text.charCodeAt(this.pos) === 0x5d) {
      this.pos++;
      return out;
    }
    for (;;) {
      if (out.length >= this.maxArrayItems) throw new StrictDeviceAuthJsonError("array too large.");
      out.push(this.parseValue(depth + 1));
      this.skipWs();
      if (this.pos < this.text.length && this.text.charCodeAt(this.pos) === 0x2c) {
        this.pos++;
        continue;
      }
      if (this.pos < this.text.length && this.text.charCodeAt(this.pos) === 0x5d) {
        this.pos++;
        return out;
      }
      throw new StrictDeviceAuthJsonError("expected ',' or ']'.");
    }
  }

  private parseString(): string {
    if (this.pos >= this.text.length || this.text.charCodeAt(this.pos) !== 0x22) {
      throw new StrictDeviceAuthJsonError("expected a string.");
    }
    this.pos++; // consume open quote
    const text = this.text;
    const len = text.length;
    let result = "";
    for (;;) {
      if (this.pos >= len) throw new StrictDeviceAuthJsonError("unterminated string.");
      const c = text.charCodeAt(this.pos);
      if (c === 0x22) {
        this.pos++;
        return result;
      }
      if (c < 0x20) throw new StrictDeviceAuthJsonError("unescaped control character in string.");
      if (c === 0x5c) {
        this.pos++;
        if (this.pos >= len) throw new StrictDeviceAuthJsonError("unterminated escape.");
        const e = text.charCodeAt(this.pos);
        switch (e) {
          case 0x22: result += '"'; this.pos++; break;
          case 0x5c: result += "\\"; this.pos++; break;
          case 0x2f: result += "/"; this.pos++; break;
          case 0x62: result += "\b"; this.pos++; break;
          case 0x66: result += "\f"; this.pos++; break;
          case 0x6e: result += "\n"; this.pos++; break;
          case 0x72: result += "\r"; this.pos++; break;
          case 0x74: result += "\t"; this.pos++; break;
          case 0x75: {
            if (this.pos + 4 >= len) throw new StrictDeviceAuthJsonError("invalid unicode escape.");
            const hex = text.slice(this.pos + 1, this.pos + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new StrictDeviceAuthJsonError("invalid unicode escape.");
            result += String.fromCharCode(parseInt(hex, 16));
            this.pos += 4 + 1;
            break;
          }
          default:
            throw new StrictDeviceAuthJsonError("invalid escape sequence.");
        }
        continue;
      }
      result += text[this.pos];
      this.pos++;
    }
  }

  private parseNumber(): number {
    const text = this.text;
    const len = text.length;
    const start = this.pos;
    if (this.pos < len && text.charCodeAt(this.pos) === 0x2d) this.pos++;
    if (this.pos >= len) throw new StrictDeviceAuthJsonError("invalid number.");
    if (text.charCodeAt(this.pos) === 0x30) {
      this.pos++;
      if (this.pos < len && /[0-9]/.test(text[this.pos])) throw new StrictDeviceAuthJsonError("leading zero in number.");
    } else if (text.charCodeAt(this.pos) >= 0x31 && text.charCodeAt(this.pos) <= 0x39) {
      while (this.pos < len && /[0-9]/.test(text[this.pos])) this.pos++;
    } else {
      throw new StrictDeviceAuthJsonError("invalid number.");
    }
    if (this.pos < len && text.charCodeAt(this.pos) === 0x2e) {
      this.pos++;
      if (this.pos >= len || !/[0-9]/.test(text[this.pos])) throw new StrictDeviceAuthJsonError("invalid fraction.");
      while (this.pos < len && /[0-9]/.test(text[this.pos])) this.pos++;
    }
    if (this.pos < len && (text.charCodeAt(this.pos) === 0x65 || text.charCodeAt(this.pos) === 0x45)) {
      this.pos++;
      if (this.pos < len && (text.charCodeAt(this.pos) === 0x2b || text.charCodeAt(this.pos) === 0x2d)) this.pos++;
      if (this.pos >= len || !/[0-9]/.test(text[this.pos])) throw new StrictDeviceAuthJsonError("invalid exponent.");
      while (this.pos < len && /[0-9]/.test(text[this.pos])) this.pos++;
    }
    const raw = text.slice(start, this.pos);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new StrictDeviceAuthJsonError("number is not finite.");
    return value;
  }
}

/**
 * Collapse any request-handling failure to the fixed M1.08 invalid_request
 * error. The caller discards the specific cause; only the bounded code leaks.
 */
export function toDeviceAuthRequestError(error: unknown): DeviceAuthError {
  void error; // only the bounded code leaks; the specific cause is discarded
  return new DeviceAuthError("invalid_request");
}

/** Allowed non-empty JSON content types (DeviceAuth uses application/json). */
export const DEVICE_AUTH_JSON_CONTENT_TYPE = "application/json";
