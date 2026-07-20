import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { apiError, sanitizeSafeMessage, type ApiReceiptContext } from '../core/api-envelope.js';
import { canonicalJson } from '../core/canonical-payload.js';
import type { ApiSuccessEnvelope } from '../schemas/types.js';
import { SkillMapMcpToolError } from './tool-runtime.js';
import {
  SKILLMAP_MCP_REQUEST_LINE_BYTES,
  SKILLMAP_MCP_RESPONSE_BYTES,
  skillMapMcpCanonicalOutputSchemas,
  type SkillMapMcpToolName
} from './tool-schemas.js';

const WORST_CASE_REQUEST_ID = 'x'.repeat(SKILLMAP_MCP_REQUEST_LINE_BYTES);

export function toSkillMapMcpSuccessResult(
  toolName: SkillMapMcpToolName,
  envelopeValue: ApiSuccessEnvelope<unknown>
): CallToolResult {
  const parsed = skillMapMcpCanonicalOutputSchemas[toolName].safeParse(envelopeValue);
  if (!parsed.success) {
    return toSkillMapMcpErrorResult(new SkillMapMcpToolError(
      'INVALID_RUNTIME_RESULT',
      'The SkillMap runtime returned an invalid response envelope.'
    ));
  }

  let text: string;
  let structuredContent: Record<string, unknown>;
  try {
    text = canonicalJson(parsed.data);
    structuredContent = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return toSkillMapMcpErrorResult(new SkillMapMcpToolError(
      'INVALID_RUNTIME_RESULT',
      'The SkillMap runtime returned a response that is not canonical JSON.',
      { context: contextFromEnvelope(parsed.data) }
    ));
  }

  const result: CallToolResult = {
    content: [{ type: 'text', text }],
    structuredContent,
    isError: false
  };
  if (mcpResponseFrameBytes(result) > SKILLMAP_MCP_RESPONSE_BYTES) {
    return toSkillMapMcpErrorResult(new SkillMapMcpToolError(
      'RESPONSE_TOO_LARGE',
      'The SkillMap MCP result exceeded the response size limit.',
      { context: contextFromEnvelope(parsed.data) }
    ));
  }
  return result;
}

export function toSkillMapMcpErrorResult(error: unknown): CallToolResult {
  const mapped = error instanceof SkillMapMcpToolError
    ? error
    : new SkillMapMcpToolError('TOOL_CALL_FAILED', 'The SkillMap tool call failed.');
  const envelope = apiError(
    mapped.code,
    sanitizeSafeMessage(mapped.message),
    mapped.context,
    { retryable: mapped.retryable }
  );
  return {
    content: [{ type: 'text', text: canonicalJson(envelope) }],
    isError: true
  };
}

export function mcpResponseFrameBytes(result: CallToolResult): number {
  return Buffer.byteLength(JSON.stringify({
    jsonrpc: '2.0',
    id: WORST_CASE_REQUEST_ID,
    result
  }) + '\n', 'utf8');
}

function contextFromEnvelope(envelope: ApiSuccessEnvelope<unknown>): ApiReceiptContext {
  return {
    servingRevision: envelope.servingRevision,
    currentRevision: envelope.currentRevision,
    compatibility: envelope.compatibility,
    requestId: envelope.requestId
  };
}
