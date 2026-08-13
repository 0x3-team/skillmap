/// <reference types="@cloudflare/workers-types" />

// OpenNext generates the application worker during `opennextjs-cloudflare
// build`. This thin entrypoint owns the pre-Next edge authority and re-exports
// the Durable Object class required by Wrangler.
// @ts-expect-error OpenNext creates this module during the build.
import nextWorker from "./.open-next/worker.js";
import { DurableObject } from "cloudflare:workers";
import { DeviceAuthIpRateLimiterCore } from "./cloudflare/device-auth-ip-rate-limiter.ts";
import { gateDeviceAuthRequest, type DeviceAuthEdgeEnv } from "./cloudflare/device-auth-edge-gate.ts";

export class DeviceAuthIpRateLimiter extends DurableObject<DeviceAuthEdgeEnv> {
  readonly #core: DeviceAuthIpRateLimiterCore;

  constructor(ctx: DurableObjectState, env: DeviceAuthEdgeEnv) {
    super(ctx, env);
    this.#core = new DeviceAuthIpRateLimiterCore(ctx);
  }

  fetch(request: Request): Promise<Response> {
    return this.#core.fetch(request);
  }
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

const worker = {
  async fetch(request: Request, env: DeviceAuthEdgeEnv, ctx: WorkerExecutionContext): Promise<Response> {
    const gated = await gateDeviceAuthRequest(request, env);
    if (gated.response) return gated.response;
    return nextWorker.fetch(gated.request ?? request, env, ctx);
  }
};

export default worker;
