import "server-only";

import {
  assertJsonContentType,
  assertNoQuery,
  parseStrictDeviceAuthJson,
  readDeviceAuthBody
} from "@/lib/device-auth/raw-json.server";
import { getDeviceAuthServerConfig } from "@/lib/device-auth/config";
import { authenticateImportRequest } from "./import-auth.server.ts";
import {
  createImportSupabaseFactory,
  SupabaseImportAuthRepository,
  SupabaseImportRepository,
  type ImportRpcFactory
} from "./import-repository.server.ts";
import { importErrorResponse, importJsonResponse, ImportRouteError } from "./import-errors.server.ts";
import { executeImportOperation, type ImportOperation, type ImportRouteParams } from "./import-service.server.ts";

const SMALL_BODY_LIMIT = 16 * 1024;
const TARGET_BODY_LIMIT = 4 * 1024 * 1024;

export interface ImportRouteDependencies {
  factory?: ImportRpcFactory;
  now?: () => Date;
  authNow?: () => number;
  environment?: Record<string, string | undefined>;
}

export async function handleImportRoute(
  request: Request,
  operation: ImportOperation,
  params: ImportRouteParams = {},
  dependencies: ImportRouteDependencies = {}
): Promise<Response> {
  try {
    const url = new URL(request.url);
    assertNoQuery(url);
    assertJsonContentType(request);
    const target = operation === "prepare-target";
    const rawBody = await readDeviceAuthBody(request, target ? TARGET_BODY_LIMIT : SMALL_BODY_LIMIT);
    let body: unknown;
    try {
      body = parseStrictDeviceAuthJson(
        new TextDecoder("utf-8", { fatal: true }).decode(rawBody),
        target ? { maxObjectMembers: 16_512, maxArrayItems: 2_048 } : undefined
      );
    } catch {
      throw new ImportRouteError("invalid_request");
    }
    const cfg = getDeviceAuthServerConfig(dependencies.environment);
    const factory = dependencies.factory ?? createImportSupabaseFactory(cfg.supabaseUrl, cfg.serviceRoleKey);
    const context = await authenticateImportRequest({
      request,
      rawBody,
      configuredOrigin: cfg.verificationUrl,
      repository: new SupabaseImportAuthRepository(factory),
      now: dependencies.authNow
    });
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    const result = await executeImportOperation({
      operation,
      body,
      params,
      context,
      idempotencyKey,
      repository: new SupabaseImportRepository(factory),
      now: dependencies.now
    });
    return importJsonResponse(result);
  } catch (error) {
    return importErrorResponse(error);
  }
}
