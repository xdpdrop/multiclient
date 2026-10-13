import { z } from 'zod';
import { contextRoutes, contextRefSchema, contextSnapshotSchema } from './context';
import { organizationRoutes, tagNamesSchema } from './organization';
import { memoryRoutes } from './memory';
import { researchRoutes, sourceCitationAuditSchema } from './research';
import { artifactRoutes, artifactReferenceSchema, exportedArtifactSchema } from './artifacts';
import { comparisonRoutes } from './comparison';
export const id = z.string().uuid();
export const providerId = z.enum([
  'codex',
  'claude-code',
  'cursor',
  'openai',
  'anthropic',
  'compatible',
  'demo',
]);
export const appearanceSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    background: id.nullable(),
    backgroundType: z.enum(['image', 'video', 'gif']),
    backgroundOpacity: z.number().min(0).max(1),
    surfaceOpacity: z.number().min(0.35).max(1),
    dimming: z.number().min(0).max(0.9),
    blur: z.number().min(0).max(32),
    reducedMotion: z.boolean(),
  })
  .strict();
export const settingsSchema = z
  .object({
    appearance: appearanceSchema,
    sidebarCollapsed: z.boolean(),
    terminalOpen: z.boolean(),
    fontSize: z.number().int().min(12).max(24).optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
    notifications: z.boolean().optional(),
  })
  .strict();
export const settingsPatchSchema = settingsSchema
  .partial()
  .extend({ appearance: appearanceSchema.partial().optional() })
  .strict();
export const attachmentSchema = z
  .object({
    path: z.string().max(4096),
    content: z.string().max(500000),
    kind: z.enum(['text', 'image', 'pdf']).optional(),
    assetId: id.optional(),
    name: z.string().max(255).optional(),
    mime: z.string().max(100).optional(),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(25 * 1024 * 1024)
      .optional(),
    pages: z
      .array(z.object({ page: z.number().int().min(1), text: z.string().max(100000) }).strict())
      .max(500)
      .optional(),
    delivery: z.enum(['native', 'text']).optional(),
  })
  .strict()
  .refine(
    (a) => !a.kind || a.kind === 'text' || !!a.assetId,
    'Images and documents must be imported before sending.',
  );
export const draftSchema = z
  .object({
    text: z.string().max(100000),
    attachments: z.array(attachmentSchema).max(10),
    provider: providerId,
    model: z.string().max(200),
    mode: z.string().max(80),
    effort: z.string().max(40),
    customModel: z.boolean().optional(),
    historyMessageIds: z.array(id).max(10000).optional(),
    contextRefs: z.array(contextRefSchema).max(30).optional(),
    excludedContextSnapshotIds: z.array(id).max(10000).optional(),
    artifactReferences: z.array(artifactReferenceSchema).max(10).optional(),
  })
  .strict();
export const questionAnswerSchema = z
  .object({ selected: z.array(z.string().max(10000)).max(100), text: z.string().max(10000) })
  .strict();
const importedAssetSchema = z
  .object({
    id,
    mime: z.string().max(100),
    type: z.enum(['image', 'video', 'gif', 'pdf']),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const exportedMessageSchema = z
  .object({
    id: id.optional(),
    role: z.enum(['user', 'assistant', 'system']),
    text: z.string().max(1000000),
    context: z.string().max(500000).optional(),
    contextSources: z.array(contextSnapshotSchema).max(30).optional(),
    sourceCitations: sourceCitationAuditSchema.optional(),
    providerId,
    createdAt: z.string().datetime({ offset: true }),
    attachments: z.array(attachmentSchema).max(10).optional(),
    status: z.string().max(40).optional(),
    blocks: z
      .array(
        z
          .object({
            id: z.string().max(200),
            phase: z.enum(['commentary', 'answer']),
            text: z.string().max(1000000),
          })
          .strict(),
      )
      .max(10000)
      .optional(),
    errorInfo: z
      .object({
        code: z.string().max(100),
        message: z.string().max(4000),
        retryable: z.boolean(),
        action: z.string().max(1000).optional(),
      })
      .strict()
      .optional(),
  })
  .passthrough();
export const connectionSchema = z
  .object({
    id: providerId,
    name: z.string().max(80),
    kind: z.enum(['cli-agent', 'api-chat']),
    executable: z.string().max(4096),
    endpoint: z.string().max(2048),
    model: z.string().max(200),
    enabled: z.boolean(),
    configured: z.boolean(),
  })
  .strict();
export const sendSchema = z
  .object({
    conversationId: id,
    requestId: id,
    text: z.string().trim().min(1).max(100000),
    providerId,
    model: z.string().max(200),
    mode: z.string().max(80),
    effort: z
      .string()
      .max(40)
      .regex(/^[a-z]*$/)
      .optional(),
    handoff: z.string().max(100000).optional(),
    historyMessageIds: z.array(id).max(10000).optional(),
    contextRefs: z.array(contextRefSchema).max(30).optional(),
    excludedContextSnapshotIds: z.array(id).max(10000).optional(),
    artifactReferences: z.array(artifactReferenceSchema).max(10).optional(),
    attachments: z.array(attachmentSchema).max(10),
  })
  .strict();
export const replySchema = z
  .object({
    id,
    allow: z.boolean(),
    answers: z
      .record(z.string(), z.union([z.string().max(10000), questionAnswerSchema]))
      .optional(),
  })
  .strict();
export const routes = {
  ...contextRoutes,
  ...organizationRoutes,
  ...memoryRoutes,
  ...researchRoutes,
  ...artifactRoutes,
  ...comparisonRoutes(attachmentSchema),
  snapshot: z.object({}),
  conversation: z.object({ id, before: z.string().max(100).optional() }),
  conversationAround: z.object({ id, messageId: id }),
  transcript: z.object({ id }),
  search: z.object({
    query: z.string().trim().max(500),
    projectId: id.optional(),
    providerId: providerId.optional(),
    archived: z.boolean().optional(),
    conversationId: id.optional(),
    tagIds: z.array(id).max(20).optional(),
  }),
  archivedConversations: z.object({}),
  pinConversation: z.object({ id, pinned: z.boolean() }),
  restoreConversation: z.object({ id }),
  branchConversation: z.object({ id, messageId: id, edit: z.boolean().optional() }),
  draft: z.object({ key: z.string().max(200) }),
  saveDraft: z.object({ key: z.string().max(200), draft: draftSchema.nullable() }),
  exportData: z.object({ id }),
  importData: z.object({
    data: z
      .object({
        format: z.literal('multiclient-conversation'),
        version: z.union([z.literal(1), z.literal(2)]),
        conversation: z
          .object({
            title: z.string().max(150),
            providerId,
            model: z.string().max(200),
            mode: z.string().max(80),
            effort: z.string().max(40).optional(),
            tagNames: tagNamesSchema.optional(),
          })
          .passthrough(),
        messages: z.array(exportedMessageSchema).max(100000),
        assets: z.array(importedAssetSchema).max(1000).optional(),
        artifacts: z.array(exportedArtifactSchema).max(1000).optional(),
        draft: draftSchema.optional(),
        contextSnapshots: z.array(contextSnapshotSchema).max(30).optional(),
      })
      .passthrough(),
  }),
  backupData: z.object({ path: z.string().max(4096) }),
  validateBackup: z.object({ path: z.string().max(4096) }),
  prepareAttachment: z.object({ path: z.string().max(4096) }),
  prepareAttachmentBytes: z.object({
    name: z.string().max(255),
    mime: z.string().max(100),
    bytes: z
      .array(z.number().int().min(0).max(255))
      .min(1)
      .max(10 * 1024 * 1024),
  }),
  createConversation: z.object({ projectId: id.optional(), workspaceId: id.optional() }),
  createWorktree: z.object({ projectId: id, sourceRef: z.string().trim().min(1).max(256) }),
  archiveWorkspace: z.object({ workspaceId: id }),
  restoreWorkspace: z.object({ workspaceId: id }),
  archiveConversation: z.object({ id }),
  renameConversation: z.object({ id, title: z.string().trim().min(1).max(150) }),
  addProject: z.object({ path: z.string().min(1).max(4096) }),
  trustProject: z.object({ id, trusted: z.boolean() }),
  removeProject: z.object({ id }),
  send: sendSchema,
  cancel: z.object({ conversationId: id }),
  reply: replySchema,
  saveConnection: connectionSchema,
  probe: z.object({}),
  login: z.object({ id: providerId }),
  models: z.object({ id: providerId }),
  testConnection: z.object({ id: providerId }),
  settings: settingsSchema,
  settingsPatch: settingsPatchSchema,
  files: z.object({ projectId: id, path: z.string().max(4096) }),
  readFile: z.object({ projectId: id, path: z.string().max(4096) }),
  findFiles: z.object({ projectId: id, query: z.string().max(200) }),
  projectDefaults: z.object({ projectId: id }),
  saveProjectDefaults: z.object({ projectId: id, defaults: draftSchema.partial() }),
  instructions: z.object({ projectId: id }),
  git: z.object({ projectId: id }),
  terminalOpen: z.object({ projectId: id }),
  terminalWrite: z.object({ id, data: z.string().max(65536) }),
  terminalResize: z.object({
    id,
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(300),
  }),
  terminalClose: z.object({ id }),
  registerAsset: z.object({
    id,
    mime: z.string(),
    type: z.enum(['image', 'video', 'gif', 'pdf']),
    size: z.number(),
    hash: z.string(),
  }),
  credentialState: z.object({
    id: providerId,
    configured: z.boolean(),
    changed: z.boolean().optional(),
  }),
  asset: z.object({ id }),
} as const;
export type Route = keyof typeof routes;
