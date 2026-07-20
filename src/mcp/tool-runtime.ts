import type { ApiReceiptContext } from '../core/api-envelope.js';
import type { ApiSuccessEnvelope } from '../schemas/types.js';
import type { SkillMapMcpToolInput, SkillMapMcpToolName } from './tool-schemas.js';

/**
 * Protocol-neutral boundary implemented by the local SkillMap workspace adapter.
 * The SDK server deliberately knows nothing about cwd, filesystems, or providers.
 */
export interface SkillMapMcpRuntime {
  callTool(name: SkillMapMcpToolName, input: SkillMapMcpToolInput): Promise<ApiSuccessEnvelope<unknown>>;
}

export interface SkillMapMcpToolErrorOptions {
  retryable?: boolean;
  context?: ApiReceiptContext;
}

/** A deliberately safe, stable domain failure that may cross the MCP boundary. */
export class SkillMapMcpToolError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly context: ApiReceiptContext;

  constructor(code: string, message: string, options: SkillMapMcpToolErrorOptions = {}) {
    super(message);
    this.name = 'SkillMapMcpToolError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.context = options.context ?? { servingRevision: null, currentRevision: null };
  }
}
