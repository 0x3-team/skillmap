import type { Tool, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodType } from 'zod/v4';
import {
  SKILLMAP_MCP_PAGE_SIZE_MAX,
  SKILLMAP_MCP_REQUEST_LINE_BYTES,
  SKILLMAP_MCP_RESPONSE_BYTES,
  skillMapMcpInputSchemas,
  skillMapMcpOutputSchemas,
  toSkillMapMcpJsonSchema,
  type SkillMapMcpObjectJsonSchema,
  type SkillMapMcpToolName
} from './tool-schemas.js';

export interface SkillMapMcpToolDefinition {
  name: SkillMapMcpToolName;
  title: string;
  description: string;
  inputSchema: ZodType;
  inputJsonSchema: SkillMapMcpObjectJsonSchema;
  outputSchema: ZodType;
  outputJsonSchema: SkillMapMcpObjectJsonSchema;
  annotations: ToolAnnotations;
}

const readOnlyAnnotations = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});

export const SKILLMAP_MCP_TOOL_REGISTRY: readonly SkillMapMcpToolDefinition[] = [
  definition(
    'route_prompt',
    'Route Prompt',
    'Return deterministic, prompt-free SkillMap recommendations from one approved revision.',
    skillMapMcpInputSchemas.route_prompt,
    {
      title: 'Route Prompt',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  ),
  definition(
    'search_skills',
    'Search Skills',
    'Search redacted skill metadata in one approved revision.',
    skillMapMcpInputSchemas.search_skills,
    readOnlyAnnotations('Search Skills')
  ),
  definition(
    'show_skill',
    'Show Skill',
    'Show one redacted skill record by qualified skillId.',
    skillMapMcpInputSchemas.show_skill,
    readOnlyAnnotations('Show Skill')
  ),
  definition(
    'show_skillgraph',
    'Show SkillGraph',
    'Page through the redacted effective SkillGraph.',
    skillMapMcpInputSchemas.show_skillgraph,
    readOnlyAnnotations('Show SkillGraph')
  ),
  definition(
    'doctor_summary',
    'Doctor Summary',
    'Page through compact, redacted doctor findings.',
    skillMapMcpInputSchemas.doctor_summary,
    readOnlyAnnotations('Doctor Summary')
  ),
  definition(
    'source_status',
    'Source Status',
    'Page through redacted source coverage and freshness state.',
    skillMapMcpInputSchemas.source_status,
    readOnlyAnnotations('Source Status')
  )
];

export const SKILLMAP_MCP_MANIFEST = {
  version: 2 as const,
  readOnly: true as const,
  tools: SKILLMAP_MCP_TOOL_REGISTRY.map(({ name, description, inputJsonSchema }) => ({
    name,
    description,
    inputSchema: projectLegacyManifestInputSchema(inputJsonSchema)
  })),
  limits: {
    requestBytes: SKILLMAP_MCP_REQUEST_LINE_BYTES,
    responseBytes: SKILLMAP_MCP_RESPONSE_BYTES,
    pageSizeMax: SKILLMAP_MCP_PAGE_SIZE_MAX
  },
  summary: `SkillMap MCP manifest: ${SKILLMAP_MCP_TOOL_REGISTRY.length} revision-bound read-only tool(s).`
};

export function listSkillMapMcpTools(): Tool[] {
  return SKILLMAP_MCP_TOOL_REGISTRY.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputJsonSchema as Tool['inputSchema'],
    outputSchema: tool.outputJsonSchema as Tool['outputSchema'],
    annotations: tool.annotations,
    execution: { taskSupport: 'forbidden' }
  }));
}

function definition(
  name: SkillMapMcpToolName,
  title: string,
  description: string,
  inputSchema: ZodType,
  annotations: ToolAnnotations
): SkillMapMcpToolDefinition {
  return {
    name,
    title,
    description,
    inputSchema,
    inputJsonSchema: toSkillMapMcpJsonSchema(inputSchema),
    outputSchema: skillMapMcpOutputSchemas[name],
    outputJsonSchema: toSkillMapMcpJsonSchema(skillMapMcpOutputSchemas[name]),
    annotations
  };
}

/** Preserve the established local-app manifest byte projection independently of SDK schema key order. */
function projectLegacyManifestInputSchema(schema: SkillMapMcpObjectJsonSchema): SkillMapMcpObjectJsonSchema {
  const properties = Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([name, value]) => [
      name,
      projectLegacyManifestProperty(value as Record<string, unknown>)
    ])
  );
  return {
    type: 'object',
    additionalProperties: schema.additionalProperties,
    properties,
    ...(schema.required ? { required: [...schema.required] } : {})
  };
}

function projectLegacyManifestProperty(schema: Record<string, unknown>): Record<string, unknown> {
  const orderedKeys = ['type', 'minLength', 'maxLength', 'minimum', 'maximum', 'default', 'pattern'];
  return Object.fromEntries(
    orderedKeys.filter((key) => Object.hasOwn(schema, key)).map((key) => [key, schema[key]])
  );
}
