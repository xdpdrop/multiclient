import { z } from 'zod';

const uuid = z.string().uuid();
export const artifactKind = z.enum(['markdown', 'code', 'text', 'html', 'svg', 'mermaid']);
export type ArtifactKind = z.infer<typeof artifactKind>;
export const artifactSource = z
  .string()
  .refine((s) => new TextEncoder().encode(s).length <= 100000, 'Artifact source exceeds 100 KB.');
const title = z.string().trim().min(1).max(150);
const language = z
  .string()
  .max(40)
  .regex(/^[a-zA-Z0-9_+.#-]*$/);
export const artifactReferenceSchema = z.object({ artifactId: uuid, revisionId: uuid }).strict();
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;
export type Artifact = {
  id: string;
  projectId: string | null;
  title: string;
  kind: ArtifactKind;
  language: string;
  headRevisionId: string;
  createdAt: string;
  updatedAt: string;
  originConversationId: string | null;
  originMessageId: string | null;
  forkedFromRevisionId: string | null;
};
export type ArtifactRevision = {
  id: string;
  artifactId: string;
  number: number;
  parentRevisionId: string | null;
  source: string;
  author: 'user' | 'model';
  sourceMessageId: string | null;
  createdAt: string;
  assetIds: string[];
};
export type ArtifactDraft = {
  artifactId: string;
  baseRevisionId: string;
  source: string;
  generation: number;
  sourceMessageId: string | null;
  updatedAt: string;
};
export type ArtifactView = {
  artifact: Artifact;
  revisions: ArtifactRevision[];
  draft: ArtifactDraft | null;
};
export type ArtifactMutation =
  | { ok: true; view: ArtifactView }
  | { ok: false; conflict: 'revision' | 'draft'; view: ArtifactView };
const create = z
  .object({
    title,
    kind: artifactKind,
    source: artifactSource,
    language: language.default(''),
    projectId: uuid.nullable().optional(),
    originConversationId: uuid.optional(),
    originMessageId: uuid.optional(),
    assetIds: z.array(uuid).max(100).default([]),
  })
  .strict();
const commit = z
  .object({
    id: uuid,
    expectedHeadRevisionId: uuid,
    source: artifactSource,
    author: z.enum(['user', 'model']).default('user'),
    sourceMessageId: uuid.optional(),
    assetIds: z.array(uuid).max(100).optional(),
  })
  .strict();
export const artifactRoutes = {
  artifactsList: z.object({ projectId: uuid.nullable().optional() }).strict(),
  artifactRead: z.object({ id: uuid }).strict(),
  artifactCreate: create,
  artifactSaveDraft: z
    .object({
      id: uuid,
      baseRevisionId: uuid,
      source: artifactSource,
      expectedGeneration: z.number().int().min(0),
      sourceMessageId: uuid.optional(),
    })
    .strict(),
  artifactCommit: commit,
  artifactRestore: z.object({ id: uuid, revisionId: uuid, expectedHeadRevisionId: uuid }).strict(),
  artifactFork: z
    .object({
      id: uuid,
      revisionId: uuid,
      title: title.optional(),
      projectId: uuid.nullable().optional(),
      source: artifactSource.optional(),
    })
    .strict(),
  artifactLink: z
    .object({
      conversationId: uuid,
      messageId: uuid,
      artifactId: uuid,
      revisionId: uuid,
      relation: z.enum(['created', 'context', 'proposal']),
    })
    .strict(),
  artifactPreview: z.object({ id: uuid, revisionId: uuid.optional() }).strict(),
  artifactExport: z
    .object({
      id: uuid,
      revisionId: uuid.optional(),
      format: z.enum(['source', 'pdf', 'svg', 'json']),
    })
    .strict(),
  artifactImport: z.object({}).strict(),
  artifactImportData: z
    .object({
      data: z.unknown(),
      assets: z
        .array(
          z
            .object({
              id: uuid,
              mime: z.string().max(100),
              type: z.string().max(40),
              size: z
                .number()
                .int()
                .min(0)
                .max(25 * 1024 * 1024),
              hash: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict(),
        )
        .max(1000),
    })
    .strict(),
};
export type ArtifactRoute = keyof typeof artifactRoutes;
export const artifactRuntimeRoutes = Object.keys(artifactRoutes).filter(
  (r) => !['artifactPreview', 'artifactExport', 'artifactImport'].includes(r),
) as ArtifactRoute[];
export type ArtifactCreate = z.input<typeof create>;
export interface ArtifactsApi {
  artifactsList(projectId?: string | null): Promise<Artifact[]>;
  artifactRead(id: string): Promise<ArtifactView>;
  artifactCreate(input: ArtifactCreate): Promise<ArtifactView>;
  artifactSaveDraft(
    input: z.input<typeof artifactRoutes.artifactSaveDraft>,
  ): Promise<ArtifactMutation>;
  artifactCommit(input: z.input<typeof commit>): Promise<ArtifactMutation>;
  artifactRestore(input: z.input<typeof artifactRoutes.artifactRestore>): Promise<ArtifactMutation>;
  artifactFork(input: z.input<typeof artifactRoutes.artifactFork>): Promise<ArtifactView>;
  artifactLink(input: z.input<typeof artifactRoutes.artifactLink>): Promise<void>;
  artifactPreview(input: z.input<typeof artifactRoutes.artifactPreview>): Promise<void>;
  artifactExport(input: z.input<typeof artifactRoutes.artifactExport>): Promise<void>;
  artifactImport(): Promise<ArtifactView | null>;
}
export const exportedArtifactSchema = z
  .object({
    id: uuid,
    title,
    kind: artifactKind,
    language,
    headRevisionId: uuid,
    revisions: z
      .array(
        z
          .object({
            id: uuid,
            number: z.number().int().min(1),
            parentRevisionId: uuid.nullable(),
            source: artifactSource,
            author: z.enum(['user', 'model']),
            createdAt: z.string().datetime({ offset: true }),
            assetIds: z.array(uuid).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    references: z
      .array(
        z
          .object({
            messageId: uuid,
            revisionId: uuid,
            relation: z.enum(['created', 'context', 'proposal']),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export type ExportedArtifact = z.infer<typeof exportedArtifactSchema>;
export const artifactBundleSchema = z
  .object({
    format: z.literal('multiclient-artifact'),
    version: z.literal(1),
    artifact: exportedArtifactSchema,
    draft: z.object({ baseRevisionId: uuid, source: artifactSource }).strict().nullable(),
  })
  .strict();
export function validateExportedArtifacts(
  raw: unknown[],
  messageIds: Set<string>,
  assetIds: Set<string>,
): ExportedArtifact[] {
  const inputs = raw.map((a) => exportedArtifactSchema.parse(a));
  if (inputs.length > 1000 || new Set(inputs.map((a) => a.id)).size !== inputs.length)
    throw new Error('Too many or duplicate exported artifacts.');
  const revisionIds = new Set<string>();
  for (const a of inputs) {
    const sorted = [...a.revisions].sort((a, b) => a.number - b.number);
    for (const [index, r] of sorted.entries()) {
      if (
        revisionIds.has(r.id) ||
        r.number !== index + 1 ||
        r.parentRevisionId !== (sorted[index - 1]?.id ?? null)
      )
        throw new Error('Invalid artifact revision history.');
      revisionIds.add(r.id);
      if (
        r.assetIds.some((id) => !assetIds.has(id)) ||
        new Set(r.assetIds).size !== r.assetIds.length
      )
        throw new Error('An exported artifact image is missing or duplicated.');
      if (
        [...r.source.matchAll(/media:\/\/assets\/([0-9a-f-]{36})/gi)].some(
          (m) => !r.assetIds.includes(m[1].toLowerCase()),
        )
      )
        throw new Error('An exported artifact image reference is invalid.');
    }
    if (
      a.headRevisionId !== sorted[sorted.length - 1].id ||
      a.references.some(
        (r) =>
          !messageIds.has(r.messageId) ||
          !a.revisions.some((revision) => revision.id === r.revisionId),
      )
    )
      throw new Error('An exported artifact reference is missing.');
    const refs = a.references.map((r) => `${r.messageId}:${r.revisionId}:${r.relation}`);
    if (new Set(refs).size !== refs.length)
      throw new Error('Duplicate exported artifact message references.');
  }
  return inputs;
}
export function remapArtifactAssets(artifacts: ExportedArtifact[], mapping: Map<string, string>) {
  return artifacts.map((a) => ({
    ...a,
    revisions: a.revisions.map((r) => ({
      ...r,
      assetIds: r.assetIds.map((id) => {
        const mapped = mapping.get(id);
        if (!mapped) throw new Error('An exported artifact image is missing.');
        return mapped;
      }),
      source: r.source.replace(/media:\/\/assets\/([0-9a-f-]{36})/gi, (_value, id: string) => {
        const mapped = mapping.get(id.toLowerCase());
        if (!mapped || !r.assetIds.includes(id.toLowerCase()))
          throw new Error('An exported artifact image reference is invalid.');
        return `media://assets/${mapped}`;
      }),
    })),
  }));
}
