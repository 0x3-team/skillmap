import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const LEGACY_COOKIE_NAME = /^skillmap_(?:cap|csrf)_\d{1,5}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface ConnectorSecurityOptions {
  host: '127.0.0.1';
  port: number;
  bootstrapTtlMs?: number;
}

export class ConnectorSecurity {
  readonly origin: string;
  readonly bootstrapToken: string;
  readonly csrfToken: string;
  private readonly capability: string;
  private readonly expiresAt: number;
  private bootstrapConsumed = false;

  constructor(options: ConnectorSecurityOptions) {
    if (options.host !== '127.0.0.1') throw new Error('SkillMap connector security only supports 127.0.0.1.');
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Connector port is invalid.');
    this.origin = `http://${options.host}:${options.port}`;
    this.bootstrapToken = randomToken();
    this.capability = randomToken();
    this.csrfToken = randomToken();
    this.expiresAt = Date.now() + (options.bootstrapTtlMs ?? 5 * 60_000);
  }

  bootstrapUrl(pathname = '/app'): string {
    const url = new URL(pathname, this.origin);
    url.searchParams.set('bootstrap', this.bootstrapToken);
    return url.toString();
  }

  tryExchangeBootstrap(requestUrl: URL, response: ServerResponse): boolean {
    const suppliedValues = requestUrl.searchParams.getAll('bootstrap');
    if (!suppliedValues.length) return false;
    const exactBootstrapRequest = requestUrl.pathname === '/app'
      && suppliedValues.length === 1
      && [...requestUrl.searchParams.keys()].length === 1;
    const supplied = suppliedValues[0];
    if (!exactBootstrapRequest || this.bootstrapConsumed || Date.now() > this.expiresAt || !safeEqual(supplied, this.bootstrapToken)) {
      throw new ConnectorAuthError(401, 'BOOTSTRAP_INVALID', 'The one-time connector bootstrap link is invalid or expired.');
    }
    this.bootstrapConsumed = true;
    const fragment = new URLSearchParams({
      'skillmap-capability': this.capability,
      'skillmap-csrf': this.csrfToken
    }).toString();
    response.statusCode = 303;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Location', `/app#${fragment}`);
    response.end();
    return true;
  }

  authorize(req: IncomingMessage, options: { mutation?: boolean; publicHealth?: boolean } = {}): void {
    this.assertHost(req);
    this.assertOrigin(req, Boolean(options.mutation));
    if (options.publicHealth) return;
    const capability = singleHeader(req.headers['x-skillmap-capability']);
    if (!capability || !TOKEN_PATTERN.test(capability) || !safeEqual(capability, this.capability)) {
      throw new ConnectorAuthError(401, 'CAPABILITY_REQUIRED', 'Open the one-time SkillMap dashboard URL from the CLI.');
    }
    if (options.mutation) {
      const header = singleHeader(req.headers['x-skillmap-csrf']);
      if (!header || !TOKEN_PATTERN.test(header) || !safeEqual(header, this.csrfToken)) {
        throw new ConnectorAuthError(403, 'CSRF_REJECTED', 'The mutation did not include the valid same-origin CSRF proof.');
      }
    }
  }

  clearLegacyCookies(req: IncomingMessage, res: ServerResponse): void {
    const names = Object.keys(parseCookies(req.headers.cookie)).filter((name) => LEGACY_COOKIE_NAME.test(name)).sort();
    if (!names.length) return;
    res.setHeader('Set-Cookie', names.map((name) => {
      const httpOnly = name.startsWith('skillmap_cap_') ? '; HttpOnly' : '';
      return `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict${httpOnly}`;
    }));
  }

  private assertHost(req: IncomingMessage): void {
    const host = singleHeader(req.headers.host);
    const expected = new URL(this.origin).host;
    if (host !== expected) throw new ConnectorAuthError(400, 'HOST_REJECTED', 'The request Host header is not trusted by this local connector.');
  }

  private assertOrigin(req: IncomingMessage, required: boolean): void {
    const origin = singleHeader(req.headers.origin);
    if (required && !origin) throw new ConnectorAuthError(403, 'ORIGIN_REQUIRED', 'Mutation requests require a same-origin Origin header.');
    if (origin && origin !== this.origin) throw new ConnectorAuthError(403, 'ORIGIN_REJECTED', 'Cross-origin requests are not allowed by this local connector.');
    const fetchSite = singleHeader(req.headers['sec-fetch-site']);
    if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) throw new ConnectorAuthError(403, 'FETCH_SITE_REJECTED', 'Cross-site requests are not allowed by this local connector.');
  }
}

export class ConnectorAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ConnectorAuthError';
    this.status = status;
    this.code = code;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const pair of (header ?? '').split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) cookies[key] = value;
  }
  return cookies;
}

function randomToken(): string { return randomBytes(32).toString('base64url'); }

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}
