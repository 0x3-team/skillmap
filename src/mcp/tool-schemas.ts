import { z, type ZodType } from 'zod/v4';

export const SKILLMAP_MCP_REQUEST_LINE_BYTES = 64 * 1024;
export const SKILLMAP_MCP_RESPONSE_BYTES = 512 * 1024;
export const SKILLMAP_MCP_PAGE_SIZE_MAX = 100;
export const SKILLMAP_MCP_ROUTE_PROMPT_BYTES = 32 * 1024;
export const SKILLMAP_MCP_QUERY_BYTES = 256;
export const SKILLMAP_MCP_CURSOR_BYTES = 1024;

export const SKILLMAP_MCP_TOOL_NAMES = [
  'route_prompt',
  'search_skills',
  'show_skill',
  'show_skillgraph',
  'doctor_summary',
  'source_status'
] as const;

export type SkillMapMcpToolName = typeof SKILLMAP_MCP_TOOL_NAMES[number];

const skillIdSchema = z.string().regex(/^sk_[A-Za-z0-9_-]{43}$/);
const routePromptSchema = boundedUtf8String(1, SKILLMAP_MCP_ROUTE_PROMPT_BYTES, true);
const querySchema = boundedUtf8String(0, SKILLMAP_MCP_QUERY_BYTES, false);
const cursorSchema = boundedUtf8String(1, SKILLMAP_MCP_CURSOR_BYTES, false);
const limitSchema = z.number().int().min(1).max(SKILLMAP_MCP_PAGE_SIZE_MAX).optional().meta({ default: 20 });

const paginationShape = {
  limit: limitSchema,
  cursor: cursorSchema.optional()
} as const;

export const skillMapMcpInputSchemas = {
  route_prompt: closedMcpObject({
    prompt: routePromptSchema,
    max: z.number().int().min(1).max(10).optional(),
    skillId: skillIdSchema.optional()
  }),
  search_skills: closedMcpObject({
    query: querySchema.optional(),
    ...paginationShape
  }),
  show_skill: closedMcpObject({
    skillId: skillIdSchema
  }),
  show_skillgraph: closedMcpObject(paginationShape),
  doctor_summary: closedMcpObject(paginationShape),
  source_status: closedMcpObject(paginationShape)
} as const;

export type RoutePromptInput = z.infer<typeof skillMapMcpInputSchemas.route_prompt>;
export type SearchSkillsInput = z.infer<typeof skillMapMcpInputSchemas.search_skills>;
export type ShowSkillInput = z.infer<typeof skillMapMcpInputSchemas.show_skill>;
export type PaginatedMcpInput = z.infer<typeof skillMapMcpInputSchemas.show_skillgraph>;

export interface SkillMapMcpToolInputMap {
  route_prompt: RoutePromptInput;
  search_skills: SearchSkillsInput;
  show_skill: ShowSkillInput;
  show_skillgraph: PaginatedMcpInput;
  doctor_summary: PaginatedMcpInput;
  source_status: PaginatedMcpInput;
}

export type SkillMapMcpToolInput = SkillMapMcpToolInputMap[SkillMapMcpToolName];

const revisionRefSchema = z.object({
  workspaceId: z.string(),
  revisionId: z.string(),
  workspaceRevision: z.string(),
  effectiveDigest: z.string().nullable(),
  effectiveRevisionDigest: z.string().nullable()
}).strict().meta({ id: 'SkillMapRevisionRef' });

const outputSkillIdSchema = z.string().regex(/^sk_[A-Za-z0-9_-]{43}$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const tierSchema = z.enum(['active-default', 'specialist', 'explicit-only', 'archived', 'blocked']);
const variantStateSchema = z.enum(['unique', 'canonical', 'shadowed-duplicate', 'unresolved-duplicate']);
const mcpSkillSummarySchema = z.object({
  skillId: outputSkillIdSchema,
  displayName: z.string().min(1).max(200),
  contentRevision: digestSchema,
  tier: tierSchema,
  routeEligible: z.boolean(),
  qualifiedExplicitAllowed: z.boolean(),
  variantState: variantStateSchema,
  hasScripts: z.boolean(),
  referenceCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  trust: z.enum(['parsed', 'invalid-frontmatter'])
}).strict();

const routeDecisionSchema = z.object({
  kind: z.literal('skillmap.route-decision'),
  schemaVersion: z.literal(2),
  revision: revisionRefSchema,
  servingMode: z.enum(['current', 'last-known-good']),
  recommendations: z.array(z.object({
    skillId: outputSkillIdSchema,
    displayName: z.string().min(1).max(200),
    score: z.number().finite(),
    tier: tierSchema,
    reasonCodes: z.array(z.string().min(1).max(80)).max(32)
  }).strict()).max(10),
  exclusions: z.array(z.object({
    skillId: outputSkillIdSchema.optional(),
    displayName: z.string().min(1).max(200),
    reasonCode: z.string().min(1).max(80)
  }).strict()).max(12),
  hookText: z.string().max(500),
  warningState: z.enum(['none', 'degraded', 'blocked']),
  warningCodes: z.array(z.string().min(1).max(80)).max(32)
}).strict();

const routeResultSchema = z.object({
  kind: z.literal('skillmap.route-result'),
  schemaVersion: z.literal(2),
  routeId: z.string(),
  createdAt: z.string(),
  promptStored: z.literal(false),
  decision: routeDecisionSchema,
  decisionDigest: digestSchema,
  latencyMs: z.number().finite().nonnegative()
}).strict();

const graphItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('node'),
    id: z.string().min(1).max(240),
    type: z.enum(['skill', 'policy-skill', 'root', 'risk', 'resource', 'family', 'intent', 'other']),
    label: z.string().min(1).max(240)
  }).strict(),
  z.object({
    kind: z.literal('edge'),
    from: z.string().min(1).max(240),
    to: z.string().min(1).max(240),
    type: z.enum(['installed_at', 'risk_flag', 'has_reference', 'belongs_to', 'supersedes', 'overlaps', 'preferred_for', 'avoid_for', 'related']),
    source: z.enum(['scan', 'policy', 'doctor', 'source', 'curation', 'eval']),
    confidence: z.number().min(0).max(1)
  }).strict()
]);

const doctorFindingSchema = z.object({
  id: z.string().regex(/^finding_[a-f0-9]{32}$/),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  title: z.enum([
    'Duplicate skill names require policy review.',
    'Skill frontmatter is invalid.',
    'A skill description is missing.',
    'A skill contains executable scripts.',
    'A skill body is unusually large.',
    'A skill description is unusually long.',
    'A skill uses broad routing language.',
    'Skill descriptions are duplicated.',
    'A SkillMap diagnostic finding requires review.'
  ]),
  skillIds: z.array(outputSkillIdSchema).max(20),
  recommendationCode: z.enum([
    'doctor-duplicate-name',
    'doctor-invalid-frontmatter',
    'doctor-missing-description',
    'doctor-script-bearing',
    'doctor-large-body',
    'doctor-long-description',
    'doctor-broad-trigger',
    'doctor-duplicate-description',
    'doctor-unknown'
  ])
}).strict();

const sourceRecordSchema = z.object({
  skillId: outputSkillIdSchema.nullable(),
  displayName: z.string().min(1).max(200),
  contentRevision: digestSchema.nullable(),
  state: z.enum(['external-clean', 'external-modified', 'external-stale', 'external-risky-update', 'local-authored', 'local-modified', 'unknown']),
  risk: z.enum(['low', 'high']).nullable(),
  upstreamCommit: z.string().regex(/^[a-f0-9]{40,64}$/).nullable()
}).strict();

const pageSchema = (itemSchema: ZodType) => z.object({
  items: z.array(itemSchema),
  limit: z.number().int().min(1).max(SKILLMAP_MCP_PAGE_SIZE_MAX),
  hasMore: z.boolean(),
  nextCursor: z.string().min(1).max(SKILLMAP_MCP_CURSOR_BYTES).nullable(),
  sortKey: z.literal('stable-v1')
}).strict();

const compatibilitySchema = z.enum(['compatible', 'degraded', 'upgrade-required', 'client-too-new', 'incompatible']);
const envelopeShape = {
  kind: z.literal('skillmap.api-response'),
  schemaVersion: z.literal(1),
  ok: z.literal(true),
  requestId: z.string().min(1),
  servingRevision: revisionRefSchema.nullable(),
  currentRevision: revisionRefSchema.nullable(),
} as const;
const exactSuccessEnvelopeSchema = (dataSchema: ZodType) => z.object({
  ...envelopeShape,
  compatibility: compatibilitySchema,
  data: dataSchema
}).strict();

export const skillMapMcpSuccessEnvelopeSchema = z.object({
  ...envelopeShape,
  compatibility: compatibilitySchema,
  data: z.unknown()
}).strict();

export const skillMapMcpCanonicalOutputSchemas = {
  route_prompt: exactSuccessEnvelopeSchema(routeResultSchema),
  search_skills: exactSuccessEnvelopeSchema(pageSchema(mcpSkillSummarySchema)),
  show_skill: exactSuccessEnvelopeSchema(z.object({ skill: mcpSkillSummarySchema }).strict()),
  show_skillgraph: exactSuccessEnvelopeSchema(z.object({ graph: pageSchema(graphItemSchema) }).strict()),
  doctor_summary: exactSuccessEnvelopeSchema(z.object({
    summary: z.object({
      skillCount: z.number().int().nonnegative(),
      duplicateNameCount: z.number().int().nonnegative(),
      scriptBearingCount: z.number().int().nonnegative(),
      findingCount: z.number().int().nonnegative()
    }).strict(),
    findings: pageSchema(doctorFindingSchema)
  }).strict()),
  source_status: exactSuccessEnvelopeSchema(z.object({
    coverage: z.enum(['not-configured', 'not-applicable', 'partial', 'covered']),
    inventorySkills: z.number().int().nonnegative(),
    trackedSkills: z.number().int().nonnegative(),
    records: pageSchema(sourceRecordSchema)
  }).strict())
} as const;

export const SKILLMAP_MCP_OUTPUT_SCHEMA_URIS: Readonly<Record<SkillMapMcpToolName, string>> = Object.freeze({
  route_prompt: 'https://skillmap.dev/contracts/mcp-route-prompt-result/v1.schema.json',
  search_skills: 'https://skillmap.dev/contracts/mcp-search-skills-result/v1.schema.json',
  show_skill: 'https://skillmap.dev/contracts/mcp-show-skill-result/v1.schema.json',
  show_skillgraph: 'https://skillmap.dev/contracts/mcp-show-skillgraph-result/v1.schema.json',
  doctor_summary: 'https://skillmap.dev/contracts/mcp-doctor-summary-result/v1.schema.json',
  source_status: 'https://skillmap.dev/contracts/mcp-source-status-result/v1.schema.json'
});

/**
 * The handler validates the complete canonical schema above. These advertised
 * schemas remain self-contained for MCP clients while freezing the envelope,
 * per-tool data shape, and collection slots within the 16 KiB tools/list cap.
 * The packaged canonical contracts retain every nested constraint.
 */
const advertisedObjectSlot = z.object({}).passthrough();
const advertisedPageSchema = (itemSchema: ZodType) => z.object({
  items: z.array(itemSchema),
  limit: z.number().int().min(1).max(SKILLMAP_MCP_PAGE_SIZE_MAX),
  hasMore: z.boolean(),
  nextCursor: z.string().min(1).max(SKILLMAP_MCP_CURSOR_BYTES).nullable(),
  sortKey: z.literal('stable-v1')
}).strict();
const advertisedEnvelopeSchema = (dataSchema: ZodType) => exactSuccessEnvelopeSchema(dataSchema);

export const skillMapMcpOutputSchemas = {
  route_prompt: advertisedEnvelopeSchema(z.object({
    kind: z.literal('skillmap.route-result'),
    schemaVersion: z.literal(2),
    routeId: z.string(),
    createdAt: z.string(),
    promptStored: z.literal(false),
    decision: advertisedObjectSlot,
    decisionDigest: digestSchema,
    latencyMs: z.number().finite().nonnegative()
  }).strict()),
  search_skills: advertisedEnvelopeSchema(advertisedPageSchema(mcpSkillSummarySchema)),
  show_skill: advertisedEnvelopeSchema(z.object({ skill: mcpSkillSummarySchema }).strict()),
  show_skillgraph: advertisedEnvelopeSchema(z.object({ graph: advertisedPageSchema(advertisedObjectSlot) }).strict()),
  doctor_summary: advertisedEnvelopeSchema(z.object({
    summary: z.object({
      skillCount: z.number().int().nonnegative(),
      duplicateNameCount: z.number().int().nonnegative(),
      scriptBearingCount: z.number().int().nonnegative(),
      findingCount: z.number().int().nonnegative()
    }).strict(),
    findings: advertisedPageSchema(advertisedObjectSlot)
  }).strict()),
  source_status: advertisedEnvelopeSchema(z.object({
    coverage: z.enum(['not-configured', 'not-applicable', 'partial', 'covered']),
    inventorySkills: z.number().int().nonnegative(),
    trackedSkills: z.number().int().nonnegative(),
    records: advertisedPageSchema(advertisedObjectSlot)
  }).strict())
} as const;

export interface SkillMapMcpObjectJsonSchema {
  type: 'object';
  properties?: Record<string, object>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export function isSkillMapMcpToolName(value: unknown): value is SkillMapMcpToolName {
  return typeof value === 'string' && SKILLMAP_MCP_TOOL_NAMES.includes(value as SkillMapMcpToolName);
}

export function parseSkillMapMcpToolInput<Name extends SkillMapMcpToolName>(
  name: Name,
  value: unknown
): SkillMapMcpToolInputMap[Name] {
  return skillMapMcpInputSchemas[name].parse(value ?? {}) as SkillMapMcpToolInputMap[Name];
}

export function toSkillMapMcpJsonSchema(schema: ZodType): SkillMapMcpObjectJsonSchema {
  const generated = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _schemaDialect, ...jsonSchema } = generated;
  if (jsonSchema.type !== 'object') throw new Error('SkillMap MCP schemas must describe JSON objects.');
  return jsonSchema as SkillMapMcpObjectJsonSchema;
}

export function canonicalSkillMapMcpOutputJsonSchema(name: SkillMapMcpToolName): SkillMapMcpObjectJsonSchema {
  return toSkillMapMcpJsonSchema(skillMapMcpCanonicalOutputSchemas[name]);
}

function boundedUtf8String(minBytes: number, maxBytes: number, advertiseMinimum: boolean) {
  const base = advertiseMinimum ? z.string().min(minBytes).max(maxBytes) : z.string().max(maxBytes);
  return base
    .refine((value) => !value.includes('\0') && Buffer.byteLength(value, 'utf8') >= minBytes && Buffer.byteLength(value, 'utf8') <= maxBytes, {
      message: `Value must contain ${minBytes}-${maxBytes} UTF-8 bytes and no null byte.`
    });
}

/**
 * Keep the advertised schema closed-world without letting Zod include an
 * attacker-controlled unknown property name in its validation issue. The MCP
 * SDK renders validation issues into tool-error content before our handler is
 * called, so unknown-key failures must use one fixed, root-level issue.
 */
function closedMcpObject<Shape extends z.ZodRawShape>(shape: Shape) {
  const allowedKeys = new Set(Object.keys(shape));
  return z.object(shape)
    .passthrough()
    .superRefine((value, context) => {
      if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
        context.addIssue({ code: 'custom', message: 'Invalid tool arguments.' });
      }
    })
    .meta({ additionalProperties: false });
}
