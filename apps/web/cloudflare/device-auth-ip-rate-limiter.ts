/**
 * The shared source-IP authority for DeviceAuth initiation.
 *
 * This class is exported from the Worker entrypoint and is bound as a
 * SQLite-backed Durable Object. Durable Object request serialization makes the
 * rolling timestamp read/trim/append operation one authority across isolates
 * and locations. At most five active timestamps are retained per bucket.
 */

interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): Iterable<Record<string, unknown>>;
}

interface DurableObjectStateLike {
  storage: { sql: SqlStorageLike };
}

interface InitiationRequest {
  bucketKey: string;
  limit: number;
  windowMs: number;
  now: number;
}

const LIMIT = 5;
const WINDOW_MS = 600_000;
const MAX_BODY_BYTES = 4_096;

export class DeviceAuthIpRateLimiterCore {
  readonly #state: DurableObjectStateLike;

  constructor(state: DurableObjectStateLike) {
    this.#state = state;
    state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS device_auth_ip_buckets (
        bucket_key TEXT NOT NULL,
        observed_at INTEGER NOT NULL
      )
    `);
    state.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS device_auth_ip_buckets_lookup
      ON device_auth_ip_buckets (bucket_key, observed_at)
    `);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/check") {
      return json({ error: "not_found" }, 404);
    }

    let input: InitiationRequest;
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return json({ error: "invalid_request" }, 400);
      input = parseInput(body);
    } catch {
      return json({ error: "invalid_request" }, 400);
    }

    try {
      const rows = [...this.#state.storage.sql.exec(
        "SELECT observed_at AS observedAt FROM device_auth_ip_buckets WHERE bucket_key = ? ORDER BY observed_at ASC",
        input.bucketKey
      )];
      const timestamps = rows.map((row) => timestampValue(row.observedAt, input.now));
      const cutoff = input.now - WINDOW_MS;
      const active = timestamps.filter((timestamp) => timestamp > cutoff);
      if (active.length > LIMIT) throw new Error("corrupt rate-limit bucket");
      if (timestamps.length > active.length) {
        this.#state.storage.sql.exec(
          "DELETE FROM device_auth_ip_buckets WHERE bucket_key = ? AND observed_at <= ?",
          input.bucketKey,
          cutoff
        );
      }

      const allowed = active.length < LIMIT;
      const oldest = active[0];
      const resetAt = oldest === undefined ? input.now + WINDOW_MS : oldest + WINDOW_MS;
      if (allowed) {
        this.#state.storage.sql.exec(
          "INSERT INTO device_auth_ip_buckets (bucket_key, observed_at) VALUES (?, ?)",
          input.bucketKey,
          input.now
        );
      }
      const nextCount = allowed ? active.length + 1 : active.length;
      const retryAfterSeconds = allowed ? 0 : secondsUntil(resetAt, input.now);
      return json({
        allowed,
        limit: LIMIT,
        remaining: allowed ? LIMIT - nextCount : 0,
        retryAfterSeconds,
        resetAfterSeconds: retryAfterSeconds || secondsUntil(resetAt, input.now),
        resetAt
      });
    } catch {
      // The edge gate maps a non-success response to temporarily_unavailable.
      // Never grant a request when the durable authority cannot answer.
      return json({ error: "authority_unavailable" }, 503);
    }
  }
}

function parseInput(body: string): InitiationRequest {
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 4 || Object.keys(candidate).some((key) => !["bucketKey", "limit", "windowMs", "now"].includes(key))) {
    throw new Error("invalid");
  }
  if (typeof candidate.bucketKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(candidate.bucketKey)) throw new Error("invalid");
  if (candidate.limit !== LIMIT || candidate.windowMs !== WINDOW_MS) throw new Error("invalid");
  if (!Number.isSafeInteger(candidate.now) || (candidate.now as number) < 0) throw new Error("invalid");
  return {
    bucketKey: candidate.bucketKey,
    limit: LIMIT,
    windowMs: WINDOW_MS,
    now: candidate.now as number
  };
}

function timestampValue(value: unknown, now: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > now) {
    throw new Error("invalid stored row");
  }
  return value;
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1_000));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
